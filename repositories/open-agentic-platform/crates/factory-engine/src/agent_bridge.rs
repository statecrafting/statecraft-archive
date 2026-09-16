// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-007

//! Bridges Factory agent definitions to the OAP `AgentRegistry` trait.

use async_trait::async_trait;
use factory_contracts::AgentPrompt;
use orchestrator::AgentRegistry;
use std::collections::HashSet;

/// Bridges Factory process and adapter agents into the orchestrator's `AgentRegistry`.
///
/// Agent ID mapping:
/// - Process agents: `factory-{role}` (e.g., `factory-business-analyst`)
/// - Scaffold agents: `factory-{role}-{adapter}` (e.g., `factory-api-scaffolder-acme-vue-encore`)
pub struct FactoryAgentBridge {
    agent_ids: HashSet<String>,
    prompts: Vec<AgentPrompt>,
}

impl FactoryAgentBridge {
    /// Create a bridge from loaded process and adapter agent prompts.
    pub fn new(process_agents: Vec<AgentPrompt>, adapter_agents: Vec<AgentPrompt>) -> Self {
        let mut agent_ids = HashSet::new();
        let mut prompts = Vec::new();

        for agent in process_agents {
            agent_ids.insert(agent.id.clone());
            prompts.push(agent);
        }

        for agent in adapter_agents {
            agent_ids.insert(agent.id.clone());
            prompts.push(agent);
        }

        Self { agent_ids, prompts }
    }

    /// Get the prompt text for a given agent ID.
    pub fn get_prompt(&self, agent_id: &str) -> Option<&str> {
        self.prompts
            .iter()
            .find(|a| a.id == agent_id)
            .map(|a| a.prompt_text.as_str())
    }

    /// List all registered agent IDs.
    pub fn agent_ids(&self) -> impl Iterator<Item = &str> {
        self.agent_ids.iter().map(String::as_str)
    }

    /// Number of registered agents.
    pub fn len(&self) -> usize {
        self.agent_ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.agent_ids.is_empty()
    }

    /// Get the standards filter for a given agent ID (spec 055).
    ///
    /// Returns `None` if the agent has no `standards_category` and no
    /// `standards_tags` set (meaning all standards apply). Returns
    /// `Some(filter)` when per-agent filtering is configured.
    pub fn get_standards_filter(
        &self,
        agent_id: &str,
    ) -> Option<standards_loader::StandardsFilter> {
        let agent = self.prompts.iter().find(|a| a.id == agent_id)?;
        if agent.standards_category.is_none() && agent.standards_tags.is_empty() {
            return None;
        }
        Some(standards_loader::StandardsFilter {
            category: agent.standards_category.clone(),
            tags: agent.standards_tags.clone(),
        })
    }
}

#[async_trait]
impl AgentRegistry for FactoryAgentBridge {
    async fn has_agent(&self, agent_id: &str) -> bool {
        self.agent_ids.contains(agent_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_agent(id: &str, role: &str) -> AgentPrompt {
        AgentPrompt {
            id: id.into(),
            role: role.into(),
            tier: 1,
            prompt_text: format!("You are the {role} agent."),
            model_hint: None,
            source_path: std::path::PathBuf::from(format!("agents/{id}.md")),
            standards_category: None,
            standards_tags: vec![],
        }
    }

    #[tokio::test]
    async fn bridge_registers_all_agents() {
        let process = vec![
            make_agent("factory-business-analyst", "business-analyst"),
            make_agent("factory-data-architect", "data-architect"),
        ];
        let adapter = vec![make_agent(
            "factory-api-scaffolder-acme-vue-encore",
            "api-scaffolder",
        )];

        let bridge = FactoryAgentBridge::new(process, adapter);
        assert_eq!(bridge.len(), 3);
        assert!(bridge.has_agent("factory-business-analyst").await);
        assert!(bridge.has_agent("factory-api-scaffolder-acme-vue-encore").await);
        assert!(!bridge.has_agent("unknown-agent").await);
    }

    #[test]
    fn get_prompt_returns_text() {
        let agents = vec![make_agent("factory-test", "tester")];
        let bridge = FactoryAgentBridge::new(agents, vec![]);
        assert!(
            bridge
                .get_prompt("factory-test")
                .unwrap()
                .contains("tester")
        );
        assert!(bridge.get_prompt("missing").is_none());
    }

    #[test]
    fn get_standards_filter_returns_none_when_no_metadata() {
        let agents = vec![make_agent("factory-test", "tester")];
        let bridge = FactoryAgentBridge::new(agents, vec![]);
        assert!(bridge.get_standards_filter("factory-test").is_none());
    }

    #[test]
    fn get_standards_filter_returns_filter_when_tags_set() {
        let mut agent = make_agent("factory-test", "tester");
        agent.standards_tags = vec!["typescript".into(), "security".into()];
        let bridge = FactoryAgentBridge::new(vec![agent], vec![]);
        let filter = bridge.get_standards_filter("factory-test").unwrap();
        assert!(filter.category.is_none());
        assert_eq!(filter.tags, vec!["typescript", "security"]);
    }

    #[test]
    fn get_standards_filter_returns_filter_when_category_set() {
        let mut agent = make_agent("factory-test", "tester");
        agent.standards_category = Some("error-handling".into());
        let bridge = FactoryAgentBridge::new(vec![agent], vec![]);
        let filter = bridge.get_standards_filter("factory-test").unwrap();
        assert_eq!(filter.category.as_deref(), Some("error-handling"));
    }
}
