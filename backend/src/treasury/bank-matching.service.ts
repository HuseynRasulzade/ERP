import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError, NotFoundAppError } from '../common/errors/app-error';

const AUTO_MATCH_THRESHOLD = 95;
const SUGGESTION_THRESHOLD = 80;

export interface MatchCandidate {
  documentType: string;
  documentId: string;
  score: number;
  reasons: string[];
}

/**
 * BankMatchingService (spec sections 39-47, 121-123). Deterministic
 * rule + score foundation only (spec section 123 — AI matching is Phase
 * 29's boundary). One `BankTransactionMatch` row per (statement line, ERP
 * document) pair, so composite one-to-many/many-to-one matches are
 * representable (spec sections 45-46), even though this build's own
 * `suggest`/`autoMatch` only proposes simple 1:1 candidates — a manual
 * composite match is still just several `manualMatch` calls against the
 * same statement line.
 */
@Injectable()
export class BankMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async suggest(tenantId: string, statementLineId: string): Promise<MatchCandidate[]> {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: statementLineId, tenantId }, include: { statement: true } });
    if (!line) throw new NotFoundAppError('BankStatementLine', statementLineId);

    const direction = line.direction === 'DEBIT' ? 'OUTGOING' : 'INCOMING';
    const candidates = await this.prisma.settlementPayment.findMany({
      where: {
        tenantId,
        bankAccountId: line.statement.bankAccountId,
        direction,
        postingStatus: 'POSTED',
        matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] },
        amount: { gte: new Decimal(line.amount.toString()).minus('0.01').toString(), lte: new Decimal(line.amount.toString()).plus('0.01').toString() },
      },
      take: 20,
    });

    const scored: MatchCandidate[] = candidates.map((c) => {
      let score = 0;
      const reasons: string[] = [];
      if (line.externalTransactionId && c.externalTransactionId === line.externalTransactionId) {
        score += 60;
        reasons.push('external transaction id exact');
      }
      if (new Decimal(c.amount.toString()).equals(line.amount.toString())) {
        score += 25;
        reasons.push('amount exact');
      }
      if (line.bankReference && c.bankReference && line.bankReference.includes(c.bankReference)) {
        score += 10;
        reasons.push('reference match');
      }
      const dayDiff = Math.abs((c.documentDate.getTime() - line.transactionDate.getTime()) / 86_400_000);
      if (dayDiff <= 1) {
        score += 10;
        reasons.push('date within 1 day');
      } else if (dayDiff <= 3) {
        score += 5;
        reasons.push('date within 3 days');
      }
      return { documentType: 'SETTLEMENT_PAYMENT', documentId: c.id, score: Math.min(score, 100), reasons };
    });

    return scored.filter((s) => s.score >= SUGGESTION_THRESHOLD).sort((a, b) => b.score - a.score);
  }

  async autoMatch(tenantId: string, statementLineId: string, userId: string) {
    const candidates = await this.suggest(tenantId, statementLineId);
    const best = candidates[0];
    if (!best || best.score < AUTO_MATCH_THRESHOLD) {
      if (best) await this.prisma.bankStatementLine.update({ where: { id: statementLineId }, data: { matchStatus: 'SUGGESTED', matchedDocumentType: best.documentType, matchedDocumentId: best.documentId } });
      return null;
    }
    return this.manualMatch(tenantId, statementLineId, best.documentType, best.documentId, userId, 'AUTO', best.score);
  }

  /** Manual/auto match (spec sections 44, 112) — a Postgres unique
   * constraint would be the ideal concurrency guard for "one active match
   * per statement line" (spec test 172); this build enforces it with a
   * transactional re-check instead (documented — a real unique partial
   * index is a follow-up). */
  async manualMatch(tenantId: string, statementLineId: string, matchedDocumentType: string, matchedDocumentId: string, userId: string, matchMethod: 'MANUAL' | 'AUTO' | 'SUGGESTED' = 'MANUAL', matchScore?: number) {
    return this.prisma.runInTransaction(async (tx) => {
      const line = await tx.bankStatementLine.findFirst({ where: { id: statementLineId, tenantId } });
      if (!line) throw new NotFoundAppError('BankStatementLine', statementLineId);
      const existingActive = await tx.bankTransactionMatch.findFirst({ where: { tenantId, statementLineId, status: 'ACTIVE' } });
      if (existingActive) throw new ValidationAppError('This statement line already has an active match.');

      const match = await tx.bankTransactionMatch.create({
        data: { tenantId, statementLineId, matchedDocumentType, matchedDocumentId, settlementPaymentId: matchedDocumentType === 'SETTLEMENT_PAYMENT' ? matchedDocumentId : undefined, matchedAmount: line.amount, matchScore: matchScore?.toString(), matchMethod, matchedBy: userId },
      });
      await tx.bankStatementLine.update({ where: { id: statementLineId }, data: { matchStatus: matchMethod === 'AUTO' ? 'AUTO_MATCHED' : 'MANUALLY_MATCHED', matchedDocumentType, matchedDocumentId, reconciliationStatus: 'RECONCILED' } });
      if (matchedDocumentType === 'SETTLEMENT_PAYMENT') {
        await tx.settlementPayment.update({ where: { id: matchedDocumentId }, data: { matchStatus: matchMethod === 'AUTO' ? 'AUTO_MATCHED' : 'MANUALLY_MATCHED' } });
      }
      await this.audit.record({ tenantId, eventType: 'BANK_TRANSACTION_MATCHED', entityType: 'BANK_STATEMENT_LINE', entityId: statementLineId, action: 'UPDATE', userId, newValues: { matchedDocumentType, matchedDocumentId, matchMethod } }, tx);
      return match;
    });
  }

  async reverseMatch(tenantId: string, matchId: string, userId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const match = await tx.bankTransactionMatch.findFirst({ where: { id: matchId, tenantId } });
      if (!match) throw new NotFoundAppError('BankTransactionMatch', matchId);
      await tx.bankTransactionMatch.update({ where: { id: matchId }, data: { status: 'REVERSED', reversedAt: new Date() } });
      await tx.bankStatementLine.update({ where: { id: match.statementLineId }, data: { matchStatus: 'UNMATCHED', matchedDocumentType: null, matchedDocumentId: null, reconciliationStatus: 'UNRECONCILED' } });
      await this.audit.record({ tenantId, eventType: 'BANK_TRANSACTION_MATCHED', entityType: 'BANK_TRANSACTION_MATCH', entityId: matchId, action: 'UPDATE', userId, oldValues: { status: 'ACTIVE' }, newValues: { status: 'REVERSED' } }, tx);
    });
  }

  async unmatchedLines(tenantId: string, bankAccountId: string) {
    return this.prisma.bankStatementLine.findMany({ where: { tenantId, matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] }, statement: { bankAccountId } }, orderBy: { transactionDate: 'asc' } });
  }
}
