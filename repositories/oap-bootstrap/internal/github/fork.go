package github

import (
	"context"
	"fmt"
	"time"
)

// Repo is the subset of a repository we care about.
type Repo struct {
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	Fork          bool   `json:"fork"`
}

// GetRepo returns the repo, or ok=false on 404.
func (c *Client) GetRepo(ctx context.Context, owner, repo string) (Repo, bool, error) {
	var r Repo
	status, err := c.do(ctx, "GET", "/repos/"+owner+"/"+repo, nil, &r)
	if status == 404 {
		return Repo{}, false, nil
	}
	if err != nil {
		return Repo{}, false, err
	}
	return r, true, nil
}

// EnsureFork forks upstreamOwner/upstreamRepo into targetOrg as name, returning
// the resulting repo. If the target already exists it is returned unchanged
// (detect-or-skip); otherwise the fork is requested and polled until it is
// clonable. The token must have repo + admin:org on the target.
func (c *Client) EnsureFork(ctx context.Context, upstreamOwner, upstreamRepo, targetOrg, name string) (Repo, error) {
	if r, ok, err := c.GetRepo(ctx, targetOrg, name); err != nil {
		return Repo{}, err
	} else if ok {
		return r, nil // already forked: skip
	}

	body := map[string]any{"organization": targetOrg, "name": name, "default_branch_only": false}
	// Fork is asynchronous: GitHub returns 202 Accepted with the (not-yet-ready) repo.
	if _, err := c.do(ctx, "POST", "/repos/"+upstreamOwner+"/"+upstreamRepo+"/forks", body, nil); err != nil {
		return Repo{}, fmt.Errorf("request fork: %w", err)
	}

	// Poll until the fork is materialized and clonable.
	deadline := time.Now().Add(2 * time.Minute)
	for {
		if r, ok, err := c.GetRepo(ctx, targetOrg, name); err != nil {
			return Repo{}, err
		} else if ok {
			return r, nil
		}
		if time.Now().After(deadline) {
			return Repo{}, fmt.Errorf("fork %s/%s did not become available within the timeout", targetOrg, name)
		}
		select {
		case <-ctx.Done():
			return Repo{}, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}
