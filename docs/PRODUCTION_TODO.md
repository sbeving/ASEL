# ASEL Production Readiness TODO

This is the working roadmap for turning ASEL into a production-grade retail, stock, credit, and franchise management system.

## Execution Queue

Work these one by one. Each item should be implemented, tested, and then marked done with the verification that proved it.

- [x] Sales create/cancel integrity: sale creation, invoice numbering, stock decrement, installment creation, cancellation, stock restoration, and closing refresh are handled through transactional service paths. Verified with current server tests/build.
- [x] Pointage recurring verification: `verif` every 3h, stale dashboards redirect to pointage, missed verification gaps do not count as worked time. Verified with `workSession` tests and web/server/mobile typechecks.
- [x] Upload storage hygiene: image uploads are compressed before storage, and local uploads were copied to the VPS Docker uploads volume.
- [x] Treasury receipt numbering: random receipt IDs were replaced with yearly sequence numbers (`REC-YYYY-000001`) and a sparse unique index. Verified with `documentNumbers` tests and server typecheck.
- [x] Treasury transaction integrity: cashflow create/update/review/delete and mirrored caisse centrale entries now share Mongo transaction paths with single-node fallback. Verified with focused server tests and typecheck.
- [x] Treasury ledger: approved movements now post versioned ledger lines for franchise cashboxes and caisse centrale, edits/rejections/deletes void prior active lines, and `/api/cashflows/ledger` exposes scoped paginated balances. Verified with ledger service tests and server typecheck.
- [x] Installment receipts and payment ledger: paid échéances now get yearly receipt numbers/PDF receipts, payment history entries, protected receipt uploads, and visible receipt links in web. Partial payments still split the remaining balance into a new échéance. Verified with document-number tests plus server/client typechecks.
- [x] Role/API matrix tests: added route-level matrix coverage for 35 representative API contracts across all roles, including ERP, HR, pointage, treasury, map, audit, users, products, stock, receptions, and notifications. Verified with `accessMatrix` tests.
- [x] Upload object authorization audit: every upload bucket now resolves to its owning object before serving, including product images, user avatars, treasury docs/receipts, installment receipts, OCR files, and network point documents. Verified with upload access tests.
- [x] Report export system: dashboard and treasury reports now use direct Blob HTML downloads with safe filenames, no popup/redirect/print-window dependency. Verified with client typecheck and report-flow source scan.
- [x] Dashboard drilldowns: role KPI cards now link directly into the relevant ERP module for CEO/admin, HR admin, commercial director, commercial, siege employee, franchise, and vendeur dashboards; reports export through direct downloads. Verified with client typecheck.
- [x] Mobile production pass: SecureStore session auth, offline queue for pointage/location writes, idempotent client request IDs, visible sync queue, EAS APK profiles, and tracking reliability polish. Verified with mobile/server typechecks.
- [x] Backup/restore playbook: restore-grade Mongo EJSON + uploads/PDF ZIP backups, optional offsite copy, verify/restore scripts, and staging restore test. Verified with `backup:verify` and restore into `asel_restore_test`.

## 0. Immediate UI/UX Hardening

- [x] Desktop sidebar can be hidden from the top bar.
- [x] Tablet and mobile navigation use a top bar, drawer menu, and bottom quick tabs instead of forcing the desktop sidebar.
- [x] POS checkout panel is less compressed and allows the page to scroll naturally.
- [x] POS payment, document type, client, discount, note, and installment controls are grouped into clearer sections.
- [ ] Review every page at 390px, 768px, 1024px, 1366px, and 1920px.
- [ ] Replace raw tables with responsive card/table hybrids on mobile for all high-use pages.
  - [x] HR workers table now has search/role/site/status filters, mobile worker cards, and clearer loading/empty states. Verified with client typecheck and production client build.
- [ ] Standardize form footers, error states, empty states, loading states, and destructive confirmations.
- [x] Add keyboard-friendly POS flow: barcode/search focus, quantity shortcuts, validate shortcut, escape scanner/modal. Verified with client typecheck and production build.
- [ ] Add print-friendly ticket/facture/devis preview before validation.

## 1. Client Credit And Trust Scoring

- [x] Add detailed client credit profile fields:
  - monthly salary
  - additional income
  - employment status
  - employer and job title
  - housing status
  - rent or housing monthly payment
  - marital status
  - children count
  - spouse employment
  - distance to franchise
  - internal credit notes
- [x] Compute client trust score from payment history, debt, purchase relationship, stability, and profile completeness.
- [x] Show score, risk tier, recommended credit limit, and monthly payment capacity in client fiche.
- [x] Add score history snapshots so managers can see score evolution over time. Verified with server/client typechecks and production build.
- [x] Add manual override with manager approval and audit trail. Verified with credit override coverage tests plus server/client typechecks.
- [x] Add credit rules per franchise and global company policy. Verified with client-insight policy tests plus server/client typechecks.
- [x] Block or warn before installment sale if score is too low, debt too high, or late payments exist. Verified with client-insight guard tests plus server/client typechecks.
- [x] Add client document attachments: CIN, payslip, proof of address, signed agreement. Verified with client-doc upload access tests plus server/client typechecks.
- [x] Add privacy permissions for sensitive credit fields. Verified with permission tests plus server/client typechecks.

## 2. Echeances And Credit Payments

- [x] Support partial installment payment by splitting the unpaid remainder into a new due installment.
- [x] Default remainder due date is 4 days later when not explicitly selected.
- [x] Add payment receipt generation for each installment payment.
- [x] Add payment history per installment, not only split records.
- [x] Add renegotiation workflow: postpone, split, merge, waive fee, manager approval. Verified with renegotiation helper tests plus server/client typechecks and production builds.
- [x] Add automatic late status scheduler. Verified with installment notification refresh test plus server typecheck.
- [x] Add reminders through WhatsApp/SMS templates at D-7, D-3, due day, overdue. Verified with client typecheck and production build.
- [x] Add aging report: 0-7 days late, 8-30, 31-60, 60+. Verified with installment helper tests plus server/client typechecks.
- [x] Add collection dashboard by franchise and client risk. Verified with collection-risk service tests plus server/client typechecks.

## 3. POS And Sales

- [x] POS supports ticket, facture, devis, cash, card, transfer, installment, amount received, change, note, and client.
- [x] Add sale hold/resume for interrupted customers. Verified with client typecheck and production build.
- [x] Add line-level discount and global discount approval thresholds. Verified with sales discount policy tests plus server/client typechecks and production builds.
- [ ] Add returns/exchanges directly from sale detail.
- [ ] Add invoice numbering policies by franchise/year/type.
- [ ] Add receipt/facture PDF generation.
- [ ] Add thermal printer mode and A4 facture mode.
- [ ] Add offline-first POS queue for weak internet.
- [ ] Add audit diff for sale corrections and cancellations.

## 4. Day Closing

- [x] Backend calculates system sales total and item total for closing date.
- [x] Frontend auto-fills declared totals from system summary.
- [x] Closing summary shows sales count and cash amount.
- [x] Add card, transfer, installment, return, cash-in, and cash-out breakdown. Verified with server/client typechecks.
- [x] Add expected cash drawer calculation: cash sales + installment cash + cash in - cash out - refunds. Verified with closing service tests.
- [x] Add declared cash denominations form. Verified with closing service tests plus server/client typechecks.
- [x] Add variance reason requirement when difference is above threshold. Verified with closing service tests plus server/client typechecks.
- [x] Add manager validation workflow and locked day after validation. Verified with closing service tests plus server/client typechecks.
- [x] Add closing PDF/export. Verified with client typecheck and production build.

## 5. OCR And Facture Entry

- [x] OCR service no longer depends only on local Tesseract. It can use a configured HTTP OCR provider first.
- [x] Keep local pdftotext/Tesseract fallback when installed.
- [ ] Choose production OCR provider and set `OCR_HTTP_ENDPOINT` plus `OCR_HTTP_API_KEY`.
- [ ] Add provider-specific adapters for invoice OCR fields: supplier, invoice number, date, totals, VAT, line items.
- [ ] Store source document, raw OCR text, parsed JSON, confidence, and user corrections.
- [ ] Train matching rules by supplier and product reference aliases.
- [ ] Add approval queue for low-confidence lines.
- [ ] Add duplicate invoice detection by supplier + number + total + date.

## 6. Product Batch Input And Excel

- [x] Define normalized product import template:
  - name
  - category
  - supplier
  - brand
  - reference
  - barcode
  - purchase price
  - sell price
  - low stock threshold
  - initial stock by franchise
- [x] Add downloadable CSV template that opens cleanly in Excel.
- [x] Add batch upload with validation errors per row.
- [x] Add upsert mode by barcode/reference/name.
- [x] Add import commit step with audit log.
- [ ] Add native `.xlsx` parser in addition to CSV.
- [ ] Add export products, stock, clients, sales, installments, and closings.

## 7. Reports And Filters

- [ ] Sales report: by date, franchise, user, client, product, category, payment method.
- [ ] Stock report: current stock, low stock, movement history, valuation.
- [ ] Profit report: gross margin, margin percent, best/worst products.
- [ ] Credit report: outstanding balance, late clients, score distribution.
- [ ] Supplier report: purchases, receptions, price changes.
- [ ] Cash report: cashflows, closings, variances.
- [ ] Add saved filters and shareable report links.
- [ ] Add CSV/XLSX/PDF exports for every major report.

## 8. Backend And Database Production

- [ ] Add database indexes for all high-use filters.
- [ ] Add migrations or versioned startup checks for schema changes.
- [ ] Add request validation coverage for every route.
- [ ] Add rate limit profiles by route sensitivity.
- [ ] Add structured audit events for all money, stock, credit, and user actions.
- [x] Add backup and restore playbook.
- [ ] Add seed data only for development, never production.
- [ ] Add environment validation for production secrets and CORS.

## 9. Testing

- [ ] Unit tests:
  - installment schedule
  - partial payment split
  - client scoring
  - closing summary
  - permissions
  - OCR parsing
- [ ] API integration tests:
  - auth/session
  - sales checkout
  - stock movement
  - installments
  - clients
  - closings
  - receptions/OCR
- [ ] Frontend component tests for forms, modals, table/card responsive states.
- [ ] End-to-end tests:
  - login
  - POS sale
  - installment sale
  - partial installment payment
  - client scoring update
  - day closing
  - product import
- [ ] Smoke test script for production deployment.

## 10. Deployment

- [x] Production Docker compose with Mongo persistence, API, web, backups, and optional offsite backup mount.
- [ ] TLS domain instead of temporary tunnel.
- [ ] Health checks for API, database, frontend, and OCR provider.
- [ ] Error monitoring and request logs.
- [ ] Admin password rotation and forced first-login password change.
- [ ] Role/permission review before handoff.
- [ ] Final acceptance demo script for the boss.
