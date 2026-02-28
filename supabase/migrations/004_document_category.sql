ALTER TABLE documents ADD COLUMN document_category TEXT;

UPDATE documents SET document_category = CASE
  WHEN document_type IN ('operating_agreement','articles_of_organization','certificate_of_formation','trust_agreement','trust_amendment') THEN 'formation'
  WHEN document_type IN ('ein_letter','tax_return','k1','franchise_tax_receipt') THEN 'tax'
  WHEN document_type IN ('subscription_agreement','capital_call_notice','distribution_notice','side_letter','ppm','schedule_of_beneficiaries') THEN 'investor'
  WHEN document_type IN ('management_agreement','advisory_agreement','service_agreement','lease','promissory_note','guarantee','amendment') THEN 'contracts'
  WHEN document_type IN ('annual_report_filing','statement_of_information','certificate_of_good_standing','foreign_qualification') THEN 'compliance'
  WHEN document_type IN ('insurance_policy','insurance_certificate') THEN 'insurance'
  WHEN document_type IN ('resolution','consent') THEN 'governance'
  ELSE 'other'
END
WHERE document_category IS NULL;

CREATE INDEX idx_docs_category ON documents(document_category);
