// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! SkillToolDef — wraps a ParsedSkill as a ToolDef for the ToolRegistry (FR-007).

use crate::filter::compute_effective_tools;
use crate::types::{ParsedSkill, SkillType};
use serde_json::{Value, json};
use std::sync::Arc;
use tool_registry::{ToolContext, ToolDef, ToolResult};

/// Callback for dispatching prompt/agent skill execution.
/// Receives: (rendered_prompt, effective_tools, model_override).
pub type DispatchFn =
    Arc<dyn Fn(&str, &[String], Option<&str>) -> anyhow::Result<ToolResult> + Send + Sync>;

/// Callback for spawning headless background tasks.
/// Receives the rendered prompt; returns a task ID.
pub type HeadlessSpawnFn = Arc<dyn Fn(&str) -> anyhow::Result<String> + Send + Sync>;

/// A parsed skill exposed as a `ToolDef` for registration in the ToolRegistry.
///
/// Skills are invocable both as slash commands (`/skill-name args`) and as
/// tool calls via the registry (FR-007).
pub struct SkillToolDef {
    pub skill: ParsedSkill,
    /// Names of tools currently denied by the permission runtime.
    pub denied_tools: Vec<String>,
    /// Dispatch callback for prompt/agent types.
    pub dispatch: Option<DispatchFn>,
    /// Spawn callback for headless type.
    pub headless_spawn: Option<HeadlessSpawnFn>,
}

impl SkillToolDef {
    /// Compute effective tools given the set of all available tool names.
    pub fn effective_tools(&self, available: &[String]) -> Vec<String> {
        compute_effective_tools(
            &self.skill.frontmatter.allowed_tools,
            available,
            &self.denied_tools,
        )
    }
}

impl ToolDef for SkillToolDef {
    fn name(&self) -> &str {
        // Prefix with "skill:" so skill tools are namespaced in the registry.
        // We store the prefixed name in the struct to satisfy the &str lifetime.
        // Instead, return the raw name — the factory prefixes at registration time.
        &self.skill.frontmatter.name
    }

    fn description(&self) -> &str {
        self.skill
            .frontmatter
            .description
            .as_deref()
            .unwrap_or("Skill command")
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "args": {
                    "type": "string",
                    "description": "Arguments to pass to the skill"
                }
            }
        })
    }

    fn execute(&self, input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
        let args = input.get("args").and_then(|v| v.as_str()).unwrap_or("");

        let rendered = self.skill.render_prompt(args);

        match self.skill.frontmatter.skill_type {
            SkillType::Prompt | SkillType::Agent => {
                if let Some(dispatch) = &self.dispatch {
                    let available = vec![]; // Caller should populate from registry
                    let effective = self.effective_tools(&available);
                    dispatch(
                        &rendered,
                        &effective,
                        self.skill.frontmatter.model.as_deref(),
                    )
                } else {
                    // No dispatch wired — return the rendered prompt as content.
                    Ok(ToolResult::success(Value::String(rendered)))
                }
            }
            SkillType::Headless => {
                if let Some(spawn) = &self.headless_spawn {
                    let task_id = spawn(&rendered)?;
                    Ok(ToolResult::success(json!({ "task_id": task_id })))
                } else {
                    Ok(ToolResult::error(
                        "headless execution not wired — no spawn callback",
                    ))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_skill_file;
    use std::path::Path;

    fn make_skill_def(content: &str, path: &str) -> SkillToolDef {
        let result = parse_skill_file(content, Path::new(path));
        let skill = result.skill().unwrap().clone();
        SkillToolDef {
            skill,
            denied_tools: vec![],
            dispatch: None,
            headless_spawn: None,
        }
    }

    #[test]
    fn tool_def_name_and_description() {
        let def = make_skill_def(
            "---\nname: commit\ndescription: Create a commit\n---\nbody",
            "commit.md",
        );
        assert_eq!(def.name(), "commit");
        assert_eq!(def.description(), "Create a commit");
    }

    #[test]
    fn tool_def_default_description() {
        let def = make_skill_def("---\nname: foo\n---\nbody", "foo.md");
        assert_eq!(def.description(), "Skill command");
    }

    #[test]
    fn input_schema_has_args_property() {
        let def = make_skill_def("---\nname: test\n---\nbody", "test.md");
        let schema = def.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["args"].is_object());
    }

    #[test]
    fn execute_prompt_without_dispatch_returns_rendered() {
        let def = make_skill_def("---\nname: greet\n---\nHello $ARGS!", "greet.md");
        let mut ctx = ToolContext::empty();
        let result = def.execute(json!({"args": "world"}), &mut ctx).unwrap();
        assert!(!result.is_error);
        assert_eq!(result.content.as_str().unwrap(), "Hello world!");
    }

    #[test]
    fn execute_prompt_with_dispatch_calls_callback() {
        let content = "---\nname: deploy\ntype: agent\n---\nDeploy $ARGS";
        let result = parse_skill_file(content, Path::new("deploy.md"));
        let skill = result.skill().unwrap().clone();
        let called = Arc::new(std::sync::Mutex::new(false));
        let called_clone = called.clone();
        let def = SkillToolDef {
            skill,
            denied_tools: vec![],
            dispatch: Some(Arc::new(move |prompt, _tools, _model| {
                *called_clone.lock().unwrap() = true;
                assert!(prompt.contains("Deploy prod"));
                Ok(ToolResult::success(Value::String("dispatched".into())))
            })),
            headless_spawn: None,
        };
        let mut ctx = ToolContext::empty();
        let res = def.execute(json!({"args": "prod"}), &mut ctx).unwrap();
        assert!(!res.is_error);
        assert!(*called.lock().unwrap());
    }

    #[test]
    fn execute_headless_returns_task_id() {
        let content = "---\nname: lint\ntype: headless\n---\nLint code";
        let result = parse_skill_file(content, Path::new("lint.md"));
        let skill = result.skill().unwrap().clone();
        let def = SkillToolDef {
            skill,
            denied_tools: vec![],
            dispatch: None,
            headless_spawn: Some(Arc::new(|_prompt| Ok("task-42".into()))),
        };
        let mut ctx = ToolContext::empty();
        let res = def.execute(json!({}), &mut ctx).unwrap();
        assert_eq!(res.content["task_id"], "task-42");
    }

    #[test]
    fn execute_headless_without_spawn_returns_error() {
        let def = make_skill_def("---\nname: bg\ntype: headless\n---\nbg task", "bg.md");
        let mut ctx = ToolContext::empty();
        let res = def.execute(json!({}), &mut ctx).unwrap();
        assert!(res.is_error);
    }

    #[test]
    fn effective_tools_respects_denied() {
        let content =
            "---\nname: restricted\nallowed_tools:\n  - Bash\n  - FileRead\n  - Grep\n---\nbody";
        let result = parse_skill_file(content, Path::new("r.md"));
        let skill = result.skill().unwrap().clone();
        let def = SkillToolDef {
            skill,
            denied_tools: vec!["FileRead".into()],
            dispatch: None,
            headless_spawn: None,
        };
        let available = vec![
            "Bash".into(),
            "FileRead".into(),
            "Grep".into(),
            "Write".into(),
        ];
        let effective = def.effective_tools(&available);
        assert_eq!(effective, vec!["Bash".to_string(), "Grep".to_string()]);
    }
}
