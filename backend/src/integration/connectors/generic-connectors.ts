import { Injectable } from '@nestjs/common';
import { ConnectorAdapter } from '../integration-connector-registry.service';
import { ValidationAppError } from '../../common/errors/app-error';

/** GENERIC_REST — payload already arrives as parsed JSON (the transport
 * layer, e.g. a NestJS controller, has already deserialized the HTTP
 * body); this adapter only enforces it really is a plain object/array. */
@Injectable()
export class GenericRestConnectorAdapter implements ConnectorAdapter {
  readonly connectorCode = 'GENERIC_REST';

  parse(raw: Buffer | string, contentType: string) {
    if (!contentType.includes('json')) throw new ValidationAppError(`GENERIC_REST connector only accepts application/json, got '${contentType}'`);
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    try {
      return JSON.parse(text);
    } catch {
      throw new ValidationAppError('GENERIC_REST payload is not valid JSON');
    }
  }
}

/** GENERIC_WEBHOOK — same JSON parsing as REST; kept as a separate
 * connector code because webhook endpoints carry additional signature/
 * replay-protection obligations (`IntegrationWebhookService`) that a
 * plain inbound REST call does not. */
@Injectable()
export class GenericWebhookConnectorAdapter implements ConnectorAdapter {
  readonly connectorCode = 'GENERIC_WEBHOOK';

  parse(raw: Buffer | string, contentType: string) {
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    if (contentType.includes('json')) {
      try {
        return JSON.parse(text);
      } catch {
        throw new ValidationAppError('GENERIC_WEBHOOK payload is not valid JSON');
      }
    }
    // form-encoded fallback
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/** GENERIC_CSV — header-row CSV/TSV, one object per data row. No
 * quoting/escaping edge cases beyond a simple comma split (spec section
 * 237's own "minimum representative adapter", not a full RFC 4180
 * parser); XLSX/XML/fixed-width are declared connector families in the
 * registry but have no adapter implementation in this build (disclosed,
 * docs/INTEGRATION_PLATFORM.md). */
@Injectable()
export class GenericCsvConnectorAdapter implements ConnectorAdapter {
  readonly connectorCode = 'GENERIC_CSV';

  parse(raw: Buffer | string): Record<string, unknown>[] {
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => (row[h] = cells[i]?.trim()));
      return row;
    });
  }
}
