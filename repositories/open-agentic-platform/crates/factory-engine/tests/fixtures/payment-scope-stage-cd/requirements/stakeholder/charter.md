---
status: authored
owner: pmo@example.com
version: "1.0.0"
kind: charter
---

# Project Charter (synthetic, for spec 122 fixture only)

This file replicates the structural pattern of the synthetic Globex scenario
referenced in spec 121 §1 and spec 122 §1. The operator's actual project
lives outside this repo; the fixture below is synthetic but preserves the
load-bearing detail that drives SC-001: an authored `OUT-SCOPE-3` section
about payment processing whose anchorHash should pair (via Jaccard >= 0.6)
with a candidate's `IN-SCOPE-7` section.

### OBJ-1: Reduce form-correction cycles

Reduce the rate of forms returned for correction by 50% within 12
months of launch.

### IN-SCOPE-1: Online application intake

Online application intake is in scope for v1.

### OUT-SCOPE-3: Payment processing finance integration

Payment processing and Finance-systems integration is out of scope for
v1. The applicant will use the existing pre-Globex channels.

### STAKEHOLDER-1: Sponsor

Departmental PMO is the sponsor of record for the v1 cutover.
