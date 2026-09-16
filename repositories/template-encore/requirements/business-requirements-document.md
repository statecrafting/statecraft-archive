# Business Requirements

This is the born-with business requirements placeholder for a scaffolded
application. It exists so the born-with claim-provenance gate
(`tenant-tail verify-provenance --fail-on-rejected`, OAP spec 209) finds a
document to audit. With no authored requirement headings yet, the audit checks
zero claims and passes, so a freshly scaffolded app is born green rather than
red on a missing BRD.

Replace this file with your application's real business requirements. Add each
requirement as its own third-level heading (`### <KIND>-<NNN>: <title>`); the
provenance gate then re-checks that requirement as a claim against your
extraction corpus, or you tag it as an explicit assumption with a named owner.
