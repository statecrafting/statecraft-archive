# Business Requirements Document

<!--
Synthetic fabrication fixture for spec 121 SC-001.

This BRD is synthetic. It replicates the STRUCTURAL pattern the
provenance validator must catch: stakeholder / integration / scope
claims that assert an external payment system is in scope, while the
corpus alongside this file (.artifacts/extracted/business-case.txt)
explicitly says payment processing is OUT OF SCOPE. The validator audit
MUST therefore classify STK-13, INT-003, and SN-022 as Rejected.
-->

## 3. Stakeholders and Scope Constraints

### STK-13 Globex Finance / Globex ERP

Globex Finance Integrations operate the Globex ERP payment system of record.
All payment transactions route through Globex for central disbursement.

### INT-003 Globex Integration

The portal integrates with Globex for payment processing and Globex ERP reporting.
No direct database access; all calls go through the Globex API gateway.

### SN-022 Globex Scope Inclusion

Globex integration is in scope for Phase 1 of the onboarding portal.
Globex ERP configuration changes are required to support payment flows.
