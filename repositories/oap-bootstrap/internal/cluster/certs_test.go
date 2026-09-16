package cluster

import "testing"

func TestParseCertStatuses(t *testing.T) {
	// A Ready cert, a not-yet-ready cert, and one with no Ready condition at all.
	raw := []byte(`{
	  "items": [
	    {"metadata": {"name": "rauthy-tls", "namespace": "rauthy-system"},
	     "status": {"conditions": [{"type": "Ready", "status": "True", "reason": "Ready"}]}},
	    {"metadata": {"name": "tenants-wildcard", "namespace": "cert-manager"},
	     "status": {"conditions": [{"type": "Ready", "status": "False", "reason": "Pending", "message": "issuing"}]}},
	    {"metadata": {"name": "fresh", "namespace": "x"},
	     "status": {"conditions": []}}
	  ]
	}`)
	got, err := parseCertStatuses(raw)
	if err != nil {
		t.Fatalf("parseCertStatuses: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d statuses, want 3", len(got))
	}
	if !got[0].Ready || got[0].Name != "rauthy-tls" {
		t.Errorf("rauthy-tls should be Ready: %+v", got[0])
	}
	if got[1].Ready || got[1].Reason != "Pending" {
		t.Errorf("tenants-wildcard should be pending with reason: %+v", got[1])
	}
	// No Ready condition => not ready, default reason retained.
	if got[2].Ready || got[2].Reason != "Pending" {
		t.Errorf("conditionless cert should default to not-ready/Pending: %+v", got[2])
	}
}

func TestParseCertStatusesEmpty(t *testing.T) {
	got, err := parseCertStatuses([]byte(`{"items": []}`))
	if err != nil {
		t.Fatalf("parseCertStatuses: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("empty list should yield no statuses, got %d", len(got))
	}
}
