/**
 * AZ_STANDARD_COA — Azerbaijan default Chart of Accounts localization data
 * (docx spec Phase 4, sections 5-18). Pure data, no side effects — consumed
 * by ChartOfAccountsService.seedSystemTemplate() to build/refresh the
 * system template idempotently (spec section 150).
 *
 * `accountClass` is explicit per account (spec section 152: never infer
 * classification from the numeric code) even though `groupCode`/
 * `sectionCode` below ARE mechanically derived from the code — that
 * derivation is purely this seed data's own bookkeeping convenience, not
 * application logic; nothing in the accounting engine itself parses codes.
 */
import { AccountClass } from '@prisma/client';

export interface AzSectionSeed {
  code: string;
  name: string;
  sequence: number;
  statementType: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
}

export interface AzGroupSeed {
  code: string;
  name: string;
  sectionCode: string;
  sequence: number;
}

export interface AzAccountSeed {
  code: string;
  name: string;
  accountClass: AccountClass;
  parentCode?: string;
  postingAllowed?: boolean; // default true for leaf accounts
  currencyTracking?: boolean;
  quantityTracking?: boolean;
}

export const AZ_SECTIONS: AzSectionSeed[] = [
  { code: '1', name: 'UZUNMÜDDƏTLİ AKTİVLƏR', sequence: 1, statementType: 'BALANCE_SHEET' },
  { code: '2', name: 'QISAMÜDDƏTLİ AKTİVLƏR', sequence: 2, statementType: 'BALANCE_SHEET' },
  { code: '3', name: 'KAPİTAL', sequence: 3, statementType: 'BALANCE_SHEET' },
  { code: '4', name: 'UZUNMÜDDƏTLİ ÖHDƏLİKLƏR', sequence: 4, statementType: 'BALANCE_SHEET' },
  { code: '5', name: 'QISAMÜDDƏTLİ ÖHDƏLİKLƏR', sequence: 5, statementType: 'BALANCE_SHEET' },
  { code: '6', name: 'GƏLİRLƏR', sequence: 6, statementType: 'INCOME_STATEMENT' },
  { code: '7', name: 'XƏRCLƏR', sequence: 7, statementType: 'INCOME_STATEMENT' },
  { code: '8', name: 'MƏNFƏƏTLƏR (ZƏRƏRLƏR)', sequence: 8, statementType: 'INCOME_STATEMENT' },
  { code: '9', name: 'MƏNFƏƏT VERGİSİ', sequence: 9, statementType: 'INCOME_STATEMENT' },
];

export const AZ_GROUPS: AzGroupSeed[] = [
  { code: '10', name: 'Qeyri-maddi aktivlər', sectionCode: '1', sequence: 10 },
  { code: '11', name: 'Torpaq, tikili və avadanlıqlar', sectionCode: '1', sequence: 11 },
  { code: '12', name: 'İnvestisiya mülkiyyəti', sectionCode: '1', sequence: 12 },
  { code: '13', name: 'Bioloji aktivlər', sectionCode: '1', sequence: 13 },
  { code: '14', name: 'Təbii sərvətlər', sectionCode: '1', sequence: 14 },
  { code: '15', name: 'İştirak payı metodu ilə uçota alınmış investisiyalar', sectionCode: '1', sequence: 15 },
  { code: '16', name: 'Təxirə salınmış vergi aktivləri', sectionCode: '1', sequence: 16 },
  { code: '17', name: 'Uzunmüddətli debitor borcları', sectionCode: '1', sequence: 17 },
  { code: '18', name: 'Sair uzunmüddətli maliyyə aktivləri', sectionCode: '1', sequence: 18 },
  { code: '19', name: 'Sair uzunmüddətli aktivlər', sectionCode: '1', sequence: 19 },

  { code: '20', name: 'Ehtiyatlar', sectionCode: '2', sequence: 20 },
  { code: '21', name: 'Qısamüddətli debitor borcları', sectionCode: '2', sequence: 21 },
  { code: '22', name: 'Pul vəsaitləri və onların ekvivalentləri', sectionCode: '2', sequence: 22 },
  { code: '23', name: 'Sair qısamüddətli maliyyə aktivləri', sectionCode: '2', sequence: 23 },
  { code: '24', name: 'Sair qısamüddətli aktivlər', sectionCode: '2', sequence: 24 },

  { code: '30', name: 'Ödənilmiş nizamnamə (nominal) kapital', sectionCode: '3', sequence: 30 },
  { code: '31', name: 'Emissiya gəliri', sectionCode: '3', sequence: 31 },
  { code: '32', name: 'Geri alınmış kapital', sectionCode: '3', sequence: 32 },
  { code: '33', name: 'Kapital ehtiyatları', sectionCode: '3', sequence: 33 },
  { code: '34', name: 'Bölüşdürülməmiş mənfəət / ödənilməmiş zərər', sectionCode: '3', sequence: 34 },

  { code: '40', name: 'Uzunmüddətli faiz xərcləri yaradan öhdəliklər', sectionCode: '4', sequence: 40 },
  { code: '41', name: 'Uzunmüddətli qiymətləndirilmiş öhdəliklər', sectionCode: '4', sequence: 41 },
  { code: '42', name: 'Təxirə salınmış vergi öhdəlikləri', sectionCode: '4', sequence: 42 },
  { code: '43', name: 'Uzunmüddətli kreditor borcları', sectionCode: '4', sequence: 43 },
  { code: '44', name: 'Sair uzunmüddətli öhdəliklər', sectionCode: '4', sequence: 44 },

  { code: '50', name: 'Qısamüddətli faiz xərcləri yaradan öhdəliklər', sectionCode: '5', sequence: 50 },
  { code: '51', name: 'Qısamüddətli qiymətləndirilmiş öhdəliklər', sectionCode: '5', sequence: 51 },
  { code: '52', name: 'Vergi və sair məcburi ödənişlər üzrə öhdəliklər', sectionCode: '5', sequence: 52 },
  { code: '53', name: 'Qısamüddətli kreditor borcları', sectionCode: '5', sequence: 53 },
  { code: '54', name: 'Sair qısamüddətli öhdəliklər', sectionCode: '5', sequence: 54 },

  { code: '60', name: 'Əsas əməliyyat gəliri', sectionCode: '6', sequence: 60 },
  { code: '61', name: 'Sair əməliyyat gəlirləri', sectionCode: '6', sequence: 61 },
  { code: '62', name: 'Fəaliyyətin dayandırılmasından yaranan gəlirlər', sectionCode: '6', sequence: 62 },
  { code: '63', name: 'Maliyyə gəlirləri', sectionCode: '6', sequence: 63 },
  { code: '64', name: 'Fövqəladə gəlirlər', sectionCode: '6', sequence: 64 },

  { code: '70', name: 'Satışın maya dəyəri üzrə xərclər', sectionCode: '7', sequence: 70 },
  { code: '71', name: 'Kommersiya xərcləri', sectionCode: '7', sequence: 71 },
  { code: '72', name: 'İnzibati xərclər', sectionCode: '7', sequence: 72 },
  { code: '73', name: 'Sair əməliyyat xərcləri', sectionCode: '7', sequence: 73 },
  { code: '74', name: 'Fəaliyyətin dayandırılmasından yaranan xərclər', sectionCode: '7', sequence: 74 },
  { code: '75', name: 'Maliyyə xərcləri', sectionCode: '7', sequence: 75 },
  { code: '76', name: 'Fövqəladə xərclər', sectionCode: '7', sequence: 76 },

  { code: '80', name: 'Ümumi mənfəət (zərər)', sectionCode: '8', sequence: 80 },
  { code: '81', name: 'Asılı və birgə müəssisələrin mənfəətlərində/zərərlərində pay', sectionCode: '8', sequence: 81 },

  { code: '90', name: 'Mənfəət vergisi', sectionCode: '9', sequence: 90 },
];

const A = AccountClass;

export const AZ_ACCOUNTS: AzAccountSeed[] = [
  // 100-series — Long-term Assets
  { code: '101', name: 'Qeyri-maddi aktivlərin dəyəri', accountClass: A.ASSET },
  { code: '102', name: 'Qeyri-maddi aktivlər üzrə yığılmış amortizasiya və qiymətdəndüşmə zərərləri', accountClass: A.CONTRA_ASSET },
  { code: '103', name: 'Qeyri-maddi aktivlərlə bağlı məsrəflərin kapitallaşdırılması', accountClass: A.ASSET },
  { code: '111', name: 'Torpaq, tikili və avadanlıqların dəyəri', accountClass: A.ASSET },
  { code: '112', name: 'Torpaq, tikili və avadanlıqlar üzrə yığılmış amortizasiya və qiymətdəndüşmə zərərləri', accountClass: A.CONTRA_ASSET },
  { code: '113', name: 'Torpaq, tikili və avadanlıqlarla bağlı məsrəflərin kapitallaşdırılması', accountClass: A.ASSET },
  { code: '121', name: 'İnvestisiya mülkiyyətinin dəyəri', accountClass: A.ASSET },
  { code: '122', name: 'İnvestisiya mülkiyyəti üzrə yığılmış amortizasiya və qiymətdəndüşmə zərərləri', accountClass: A.CONTRA_ASSET },
  { code: '123', name: 'İnvestisiya mülkiyyəti ilə bağlı məsrəflərin kapitallaşdırılması', accountClass: A.ASSET },
  { code: '131', name: 'Bioloji aktivlərin dəyəri', accountClass: A.ASSET },
  { code: '132', name: 'Bioloji aktivlər üzrə yığılmış amortizasiya və qiymətdəndüşmə zərərləri', accountClass: A.CONTRA_ASSET },
  { code: '141', name: 'Təbii sərvətlərin (ehtiyatların) dəyəri', accountClass: A.ASSET },
  { code: '142', name: 'Təbii sərvətlərin (ehtiyatların) tükənməsi', accountClass: A.CONTRA_ASSET },
  { code: '151', name: 'Asılı müəssisələrə investisiyalar', accountClass: A.ASSET },
  { code: '152', name: 'Birgə müəssisələrə investisiyalar', accountClass: A.ASSET },
  { code: '153', name: 'Asılı və birgə müəssisələrə investisiyaların dəyərinin azalmasına görə düzəlişlər', accountClass: A.CONTRA_ASSET },
  { code: '161', name: 'Mənfəət vergisi üzrə təxirə salınmış vergi aktivləri', accountClass: A.ASSET },
  { code: '162', name: 'Digər təxirə salınmış vergi aktivləri', accountClass: A.ASSET },
  { code: '171', name: 'Alıcıların və sifarişçilərin uzunmüddətli debitor borcları', accountClass: A.ASSET, currencyTracking: true },
  { code: '172', name: 'Törəmə/asılı müəssisələrin uzunmüddətli debitor borcları', accountClass: A.ASSET, currencyTracking: true },
  { code: '173', name: 'Əsas idarəetmə heyətinin uzunmüddətli debitor borcları', accountClass: A.ASSET },
  { code: '174', name: 'İcarə üzrə uzunmüddətli debitor borcları', accountClass: A.ASSET },
  { code: '175', name: 'Tikinti müqavilələri üzrə uzunmüddətli debitor borcları', accountClass: A.ASSET },
  { code: '176', name: 'Faizlər üzrə uzunmüddətli debitor borcları', accountClass: A.ASSET },
  { code: '177', name: 'Digər uzunmüddətli debitor borcları', accountClass: A.ASSET },
  { code: '181', name: 'Ödənişə qədər saxlanılan uzunmüddətli investisiyalar', accountClass: A.ASSET },
  { code: '182', name: 'Verilmiş uzunmüddətli borclar', accountClass: A.ASSET },
  { code: '183', name: 'Digər uzunmüddətli investisiyalar', accountClass: A.ASSET },
  { code: '184', name: 'Sair uzunmüddətli maliyyə aktivlərinin dəyərinin azalmasına görə düzəlişlər', accountClass: A.CONTRA_ASSET },
  { code: '191', name: 'Gələcək hesabat dövrlərinin xərcləri', accountClass: A.ASSET },
  { code: '192', name: 'Verilmiş uzunmüddətli avanslar', accountClass: A.ASSET, currencyTracking: true },
  { code: '193', name: 'Digər uzunmüddətli aktivlər', accountClass: A.ASSET },

  // 200-series
  { code: '201', name: 'Material ehtiyatları', accountClass: A.ASSET, quantityTracking: true },
  { code: '202', name: 'İstehsalat (iş və xidmət) məsrəfləri', accountClass: A.ASSET },
  { code: '203', name: 'Tikinti müqavilələri üzrə məsrəflər', accountClass: A.ASSET },
  { code: '204', name: 'Hazır məhsul', accountClass: A.ASSET, quantityTracking: true },
  { code: '205', name: 'Mallar', accountClass: A.ASSET, quantityTracking: true },
  { code: '206', name: 'Satış məqsədi ilə saxlanılan digər aktivlər', accountClass: A.ASSET },
  { code: '207', name: 'Digər ehtiyatlar', accountClass: A.ASSET, quantityTracking: true },
  { code: '208', name: 'Ehtiyatların dəyərinin azalmasına görə düzəlişlər', accountClass: A.CONTRA_ASSET },
  { code: '211', name: 'Alıcıların və sifarişçilərin qısamüddətli debitor borcları', accountClass: A.ASSET, currencyTracking: true },
  { code: '212', name: 'Törəmə/asılı müəssisələrin qısamüddətli debitor borcları', accountClass: A.ASSET, currencyTracking: true },
  { code: '213', name: 'Əsas idarəetmə heyətinin qısamüddətli debitor borcları', accountClass: A.ASSET },
  { code: '214', name: 'İcarə üzrə qısamüddətli debitor borcları', accountClass: A.ASSET },
  { code: '215', name: 'Tikinti müqavilələri üzrə qısamüddətli debitor borcları', accountClass: A.ASSET },
  { code: '216', name: 'Faizlər üzrə qısamüddətli debitor borcları', accountClass: A.ASSET },
  { code: '217', name: 'Digər qısamüddətli debitor borcları', accountClass: A.ASSET },
  { code: '218', name: 'Şübhəli borclar üzrə düzəlişlər', accountClass: A.CONTRA_ASSET },
  { code: '221', name: 'Kassa', accountClass: A.ASSET, currencyTracking: true },
  { code: '222', name: 'Yolda olan pul köçürmələri', accountClass: A.ASSET, currencyTracking: true },
  { code: '223', name: 'Bank hesablaşma hesabları', accountClass: A.ASSET, currencyTracking: true },
  { code: '224', name: 'Tələblərə əsasən açılan digər bank hesabları', accountClass: A.ASSET, currencyTracking: true },
  { code: '225', name: 'Pul vəsaitlərinin ekvivalentləri', accountClass: A.ASSET, currencyTracking: true },
  { code: '226', name: 'ƏDV sub-uçot hesabı', accountClass: A.ASSET },
  { code: '231', name: 'Satış məqsədi ilə saxlanılan qısamüddətli investisiyalar', accountClass: A.ASSET },
  { code: '232', name: 'Ödənişə qədər saxlanılan qısamüddətli investisiyalar', accountClass: A.ASSET },
  { code: '233', name: 'Verilmiş qısamüddətli borclar', accountClass: A.ASSET },
  { code: '234', name: 'Digər qısamüddətli investisiyalar', accountClass: A.ASSET },
  { code: '235', name: 'Sair qısamüddətli maliyyə aktivlərinin dəyərinin azalmasına görə düzəlişlər', accountClass: A.CONTRA_ASSET },
  { code: '241', name: 'Əvəzləşdirilən vergilər', accountClass: A.ASSET },
  { code: '242', name: 'Gələcək hesabat dövrünün xərcləri', accountClass: A.ASSET },
  { code: '243', name: 'Verilmiş qısamüddətli avanslar', accountClass: A.ASSET, currencyTracking: true },
  { code: '244', name: 'Təhtəlhesab məbləğlər', accountClass: A.ASSET },
  { code: '245', name: 'Digər qısamüddətli aktivlər', accountClass: A.ASSET },

  // 300-series
  { code: '301', name: 'Nizamnamə (nominal) kapitalı', accountClass: A.EQUITY },
  { code: '302', name: 'Nizamnamə (nominal) kapitalın ödənilməmiş hissəsi', accountClass: A.CONTRA_EQUITY },
  { code: '311', name: 'Emissiya gəliri', accountClass: A.EQUITY },
  { code: '321', name: 'Geri alınmış kapital (səhmlər)', accountClass: A.CONTRA_EQUITY },
  { code: '331', name: 'Yenidən qiymətləndirilmə üzrə ehtiyat', accountClass: A.EQUITY },
  { code: '332', name: 'Məzənnə fərqləri üzrə ehtiyat', accountClass: A.EQUITY },
  { code: '333', name: 'Qanunvericilik üzrə ehtiyat', accountClass: A.EQUITY },
  { code: '334', name: 'Nizamnamə üzrə ehtiyat', accountClass: A.EQUITY },
  { code: '335', name: 'Digər ehtiyatlar', accountClass: A.EQUITY },
  { code: '341', name: 'Hesabat dövründə xalis mənfəət (zərər)', accountClass: A.EQUITY, postingAllowed: false },
  { code: '342', name: 'Mühasibat uçotu siyasətində dəyişikliklərlə bağlı mənfəət/zərər üzrə düzəlişlər', accountClass: A.EQUITY },
  { code: '343', name: 'Keçmiş illər üzrə bölüşdürülməmiş mənfəət / ödənilməmiş zərər', accountClass: A.EQUITY },
  { code: '344', name: 'Elan edilmiş dividendlər', accountClass: A.CONTRA_EQUITY },

  // 400-series
  { code: '401', name: 'Uzunmüddətli bank kreditləri', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '402', name: 'İşçilər üçün uzunmüddətli bank kreditləri', accountClass: A.LIABILITY },
  { code: '403', name: 'Uzunmüddətli konvertasiya olunan istiqrazlar', accountClass: A.LIABILITY },
  { code: '404', name: 'Uzunmüddətli borclar', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '405', name: 'Geri alınan məhdud tədavül müddətli imtiyazlı səhmlər — uzunmüddətli', accountClass: A.LIABILITY },
  { code: '406', name: 'Maliyyə icarəsi üzrə uzunmüddətli öhdəliklər', accountClass: A.LIABILITY },
  { code: '407', name: 'Törəmə/asılı müəssisələrə uzunmüddətli faiz xərcləri yaradan öhdəliklər', accountClass: A.LIABILITY },
  { code: '408', name: 'Digər uzunmüddətli faiz xərcləri yaradan öhdəliklər', accountClass: A.LIABILITY },
  { code: '411', name: 'İşdən azad olma ilə bağlı uzunmüddətli müavinətlər və öhdəliklər', accountClass: A.LIABILITY, postingAllowed: false },
  { code: '412', name: 'Uzunmüddətli zəmanət öhdəlikləri', accountClass: A.LIABILITY },
  { code: '413', name: 'Uzunmüddətli hüquqi öhdəliklər', accountClass: A.LIABILITY },
  { code: '414', name: 'Digər uzunmüddətli qiymətləndirilmiş öhdəliklər', accountClass: A.LIABILITY, postingAllowed: false },
  { code: '414-1', name: 'Sığorta müqavilələri üzrə uzunmüddətli öhdəliklər', accountClass: A.LIABILITY, parentCode: '414' },
  { code: '421', name: 'Mənfəət vergisi üzrə təxirə salınmış vergi öhdəlikləri', accountClass: A.LIABILITY },
  { code: '422', name: 'Digər təxirə salınmış vergi öhdəlikləri', accountClass: A.LIABILITY },
  { code: '431', name: 'Malsatan və podratçılara uzunmüddətli kreditor borcları', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '432', name: 'Törəmə/asılı cəmiyyətlərə uzunmüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '433', name: 'Tikinti müqavilələri üzrə uzunmüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '434', name: 'Faizlər üzrə uzunmüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '435', name: 'Digər uzunmüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '441', name: 'Uzunmüddətli pensiya öhdəlikləri', accountClass: A.LIABILITY },
  { code: '442', name: 'Gələcək hesabat dövrlərinin gəlirləri', accountClass: A.LIABILITY },
  { code: '443', name: 'Alınmış uzunmüddətli avanslar', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '444', name: 'Uzunmüddətli məqsədli maliyyələşmələr və daxilolmalar', accountClass: A.LIABILITY },
  { code: '445', name: 'Digər uzunmüddətli öhdəliklər', accountClass: A.LIABILITY },

  // 500-series
  { code: '501', name: 'Qısamüddətli bank kreditləri', accountClass: A.LIABILITY, currencyTracking: true, postingAllowed: false },
  { code: '501-1', name: 'Bank overdraftı', accountClass: A.LIABILITY, parentCode: '501', currencyTracking: true },
  { code: '502', name: 'İşçilər üçün qısamüddətli bank kreditləri', accountClass: A.LIABILITY },
  { code: '503', name: 'Qısamüddətli konvertasiya olunan istiqrazlar', accountClass: A.LIABILITY },
  { code: '504', name: 'Qısamüddətli borclar', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '505', name: 'Geri alınan məhdud tədavül müddətli imtiyazlı səhmlər — qısamüddətli', accountClass: A.LIABILITY },
  { code: '506', name: 'Törəmə/asılı müəssisələrə qısamüddətli faiz xərcləri yaradan öhdəliklər', accountClass: A.LIABILITY },
  { code: '507', name: 'Digər qısamüddətli faiz xərcləri yaradan öhdəliklər', accountClass: A.LIABILITY },
  { code: '511', name: 'İşdən azad olma ilə bağlı qısamüddətli müavinətlər və öhdəliklər', accountClass: A.LIABILITY, postingAllowed: false },
  { code: '512', name: 'Qısamüddətli zəmanət öhdəlikləri', accountClass: A.LIABILITY },
  { code: '513', name: 'Qısamüddətli hüquqi öhdəliklər', accountClass: A.LIABILITY },
  { code: '514', name: 'Mənfəətdə iştirak planı və müavinət planları', accountClass: A.LIABILITY },
  { code: '515', name: 'Digər qısamüddətli qiymətləndirilmiş öhdəliklər', accountClass: A.LIABILITY, postingAllowed: false },
  { code: '515-1', name: 'Sığorta müqavilələri üzrə qısamüddətli öhdəliklər', accountClass: A.LIABILITY, parentCode: '515' },
  { code: '521', name: 'Vergi öhdəlikləri', accountClass: A.LIABILITY },
  { code: '522', name: 'Sosial sığorta və təminat üzrə öhdəliklər', accountClass: A.LIABILITY },
  { code: '523', name: 'Digər məcburi ödənişlər üzrə öhdəliklər', accountClass: A.LIABILITY },
  { code: '531', name: 'Malsatan və podratçılara qısamüddətli kreditor borcları', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '532', name: 'Törəmə/asılı müəssisələrə qısamüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '533', name: 'Əməyin ödənişi üzrə işçi heyətinə olan borclar', accountClass: A.LIABILITY },
  { code: '534', name: 'Dividendlərin ödənilməsi üzrə təsisçilərə kreditor borcları', accountClass: A.LIABILITY },
  { code: '535', name: 'İcarə üzrə qısamüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '536', name: 'Tikinti müqavilələri üzrə qısamüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '537', name: 'Faizlər üzrə qısamüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '538', name: 'Digər qısamüddətli kreditor borcları', accountClass: A.LIABILITY },
  { code: '541', name: 'Qısamüddətli pensiya öhdəlikləri', accountClass: A.LIABILITY },
  { code: '542', name: 'Gələcək hesabat dövrünün gəlirləri', accountClass: A.LIABILITY },
  { code: '543', name: 'Alınmış qısamüddətli avanslar', accountClass: A.LIABILITY, currencyTracking: true },
  { code: '544', name: 'Qısamüddətli məqsədli maliyyələşmələr və daxilolmalar', accountClass: A.LIABILITY },
  { code: '545', name: 'Digər qısamüddətli öhdəliklər', accountClass: A.LIABILITY },

  // Revenue
  { code: '601', name: 'Satış', accountClass: A.REVENUE },
  { code: '602', name: 'Satılmış malların qaytarılması və ucuzlaşdırılması', accountClass: A.CONTRA_REVENUE },
  { code: '603', name: 'Verilmiş güzəştlər', accountClass: A.CONTRA_REVENUE },
  { code: '611', name: 'Sair əməliyyat gəlirləri', accountClass: A.REVENUE },
  { code: '621', name: 'Fəaliyyətin dayandırılmasından yaranan gəlirlər', accountClass: A.REVENUE },
  { code: '631', name: 'Maliyyə gəlirləri', accountClass: A.REVENUE },
  { code: '641', name: 'Fövqəladə gəlirlər', accountClass: A.REVENUE },

  // Expenses
  { code: '701', name: 'Satışın maya dəyəri üzrə xərclər', accountClass: A.EXPENSE },
  { code: '711', name: 'Kommersiya xərcləri', accountClass: A.EXPENSE },
  { code: '721', name: 'İnzibati xərclər', accountClass: A.EXPENSE },
  { code: '731', name: 'Sair əməliyyat xərcləri', accountClass: A.EXPENSE },
  { code: '741', name: 'Fəaliyyətin dayandırılmasından yaranan xərclər', accountClass: A.EXPENSE },
  { code: '751', name: 'Maliyyə xərcləri', accountClass: A.EXPENSE },
  { code: '761', name: 'Fövqəladə xərclər', accountClass: A.EXPENSE },

  // Profit/Loss and Income Tax
  { code: '801', name: 'Ümumi mənfəət (zərər)', accountClass: A.PROFIT_LOSS, postingAllowed: false },
  { code: '811', name: 'Asılı və birgə müəssisələrin mənfəətlərində/zərərlərində pay', accountClass: A.PROFIT_LOSS },
  { code: '901', name: 'Cari mənfəət vergisi üzrə xərclər', accountClass: A.TAX_EXPENSE },
  { code: '902', name: 'Təxirə salınmış mənfəət vergisi üzrə xərclər', accountClass: A.TAX_EXPENSE },
];

/** Derive the group code a top-level (3-digit) account belongs to. Only
 * ever used by the seed script itself — never by application logic. */
export function groupCodeFor(accountCode: string): string {
  const topLevel = accountCode.split('-')[0];
  return topLevel.slice(0, 2);
}

export function sectionCodeFor(groupCode: string): string {
  return groupCode.slice(0, 1);
}

/** Default dimension-rule configuration (spec section 28) — accountCode ->
 * dimension codes it requires. Kept intentionally small/pragmatic (the
 * spec explicitly says "do not treat this as immutable legislation"). */
// AGREEMENT is deliberately absent from every rule below: the spec's own
// example dimension list for 211/531 etc includes it, but no Agreement
// entity exists anywhere in this codebase (Phase 3 stops at Counterparty/
// PriceList — no Contract/Agreement model was built). Requiring a
// dimension with nothing real to reference it would force every caller
// to invent a fake value, which is worse than omitting it — see the
// per-account rationale in docs/ACCOUNTING_CORE.md and
// docs/SALES_RECONCILIATION.md.
export const AZ_DEFAULT_DIMENSION_RULES: Record<string, string[]> = {
  '171': ['PARTNER', 'COUNTERPARTY', 'SETTLEMENT_DOCUMENT', 'CURRENCY'],
  '211': ['PARTNER', 'COUNTERPARTY', 'SETTLEMENT_DOCUMENT', 'CURRENCY'],
  '192': ['PARTNER', 'COUNTERPARTY', 'CURRENCY'],
  '243': ['PARTNER', 'COUNTERPARTY', 'CURRENCY'],
  '201': ['PRODUCT', 'WAREHOUSE'],
  '204': ['PRODUCT', 'WAREHOUSE'],
  '205': ['PRODUCT', 'WAREHOUSE'],
  '207': ['PRODUCT', 'WAREHOUSE'],
  '221': ['CASHBOX', 'CURRENCY'],
  '223': ['BANK_ACCOUNT', 'CURRENCY'],
  '224': ['BANK_ACCOUNT', 'CURRENCY'],
  '431': ['PARTNER', 'COUNTERPARTY', 'SETTLEMENT_DOCUMENT', 'CURRENCY'],
  '531': ['PARTNER', 'COUNTERPARTY', 'SETTLEMENT_DOCUMENT', 'CURRENCY'],
  '538': ['PARTNER', 'COUNTERPARTY', 'SETTLEMENT_DOCUMENT', 'CURRENCY'],
  '443': ['PARTNER', 'COUNTERPARTY', 'CURRENCY'],
  '543': ['PARTNER', 'COUNTERPARTY', 'CURRENCY'],
  '601': ['PRODUCT'],
  '701': ['PRODUCT', 'WAREHOUSE'],
};

/** Default Azerbaijan mapping-key -> account code (spec section 41). */
export const AZ_DEFAULT_MAPPINGS: Record<string, string> = {
  CASH: '221',
  BANK: '223',
  MATERIAL_INVENTORY: '201',
  FINISHED_GOODS: '204',
  GOODS_INVENTORY: '205',
  CUSTOMER_RECEIVABLE: '211',
  SUPPLIER_ADVANCE: '243',
  CUSTOMER_ADVANCE: '543',
  SUPPLIER_PAYABLE: '531',
  SALES_REVENUE: '601',
  SALES_RETURN: '602',
  SALES_DISCOUNT: '603',
  COGS: '701',
  COMMERCIAL_EXPENSE: '711',
  ADMIN_EXPENSE: '721',
  OTHER_OPERATING_INCOME: '611',
  OTHER_OPERATING_EXPENSE: '731',
  CURRENT_INCOME_TAX_EXPENSE: '901',
  // Tax Engine build (docx spec Phase 5, sections 38-39, 61-63): default AZ
  // VAT account assignments. Configurable per-organization via
  // AccountingMappingService.upsert like any other mapping key — nothing
  // in the Tax Engine hardcodes these account numbers.
  VAT_INPUT_RECOVERABLE: '241', // Əvəzləşdirilən vergilər
  VAT_INPUT_PENDING: '226', // ƏDV sub-uçot hesabı
  VAT_INPUT_NONRECOVERABLE: '241',
  VAT_OUTPUT_PAYABLE: '521', // Vergi öhdəlikləri
  VAT_DEPOSIT_ACCOUNT: '226',
  VAT_SETTLEMENT: '226',
  VAT_ROUNDING: '731', // Sair əməliyyat xərcləri
  VAT_ADJUSTMENT: '731',
  // Purchase / Procurement build (docx spec Phase 9, section 5 Model A):
  // Goods Receipt posts to a clearing liability distinct from the real
  // Supplier Payable (531) — Purchase Invoice posting clears it.
  GOODS_RECEIVED_NOT_INVOICED: '538', // Digər qısamüddətli kreditor borcları
};
