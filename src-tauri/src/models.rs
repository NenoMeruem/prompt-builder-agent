// models.rs — Shared data structures for Prompt, RunRecord, and LLM Messages.
// These mirror the Go pkg/models/prompt.go data model exactly for DB compatibility.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A single step within a chained prompt pipeline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecipeStep {
    pub step_id: String,
    #[serde(default)]
    pub name: String,
    pub template: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_output_key")]
    pub output_key: String,
}

fn default_output_key() -> String {
    "result".to_string()
}

/// A prompt recipe stored in the database.
/// Mirrors Go's `pkg/models.Prompt`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub description: String,
    pub engine: String,
    pub template: String,
    /// Extracted `{{variable}}` names from the template.
    pub variables: Vec<String>,
    /// Optional param modifiers: `["tone", "length", "complexity"]`.
    #[serde(default)]
    pub params: Vec<String>,
    /// Optional chained prompt pipeline steps for multi-step LCEL execution.
    #[serde(default)]
    pub steps: Option<Vec<RecipeStep>>,
    /// Emoji or icon name shown in the sidebar.
    #[serde(default)]
    pub icon: String,
    /// Lower value → higher position in sidebar list.
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A single run record persisted to run_history.
/// Mirrors Go's `pkg/models.RunRecord`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
    /// Groups all turns of a multi-turn conversation together.
    pub session_id: String,
    /// 0 = initial run, 1, 2, 3... = follow-up turns.
    pub turn_index: i64,
    pub prompt_id: String,
    pub engine: String,
    pub input_text: String,
    pub final_prompt: String,
    pub response: String,
    pub duration_ms: i64,
    #[serde(default)]
    pub error: String,
    pub created_at: DateTime<Utc>,
}

/// A single turn in a multi-turn LLM conversation.
/// Mirrors Go's `llm.Message`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Either `"user"` or `"assistant"`.
    pub role: String,
    pub content: String,
}

/// An LLM request. Either `prompt` (single-turn) or `messages` (multi-turn).
/// Mirrors Go's `llm.Request`.
#[derive(Debug, Clone)]
pub struct LlmRequest {
    /// Single-turn prompt text. Ignored when `messages` is non-empty.
    pub prompt: String,
    /// The model identifier (e.g. `"gemini-2.5-flash-lite"`).
    pub model: String,
    /// Multi-turn conversation history. Overrides `prompt` when set.
    pub messages: Vec<Message>,
    /// Optional chained pipeline steps for multi-step LangChain execution.
    pub steps: Option<Vec<RecipeStep>>,
}

/// A single chunk emitted from a streaming LLM response.
/// Mirrors Go's `llm.Chunk` with support for multi-step pipeline metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Chunk {
    pub text: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_steps: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
}

impl Chunk {
    pub fn new_text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            done: false,
            error: None,
            ..Default::default()
        }
    }

    pub fn new_done() -> Self {
        Self {
            text: String::new(),
            done: true,
            error: None,
            ..Default::default()
        }
    }

    pub fn new_error(err: impl Into<String>) -> Self {
        Self {
            text: String::new(),
            done: true,
            error: Some(err.into()),
            ..Default::default()
        }
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_serializes_to_json() {
        let p = Prompt {
            id: "test-id".into(),
            name: "Test Prompt".into(),
            description: "A description".into(),
            engine: "gemini".into(),
            template: "Hello {{name}}".into(),
            variables: vec!["name".into()],
            params: vec![],
            steps: None,
            icon: "🤖".into(),
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("test-id"));
    }

    #[test]
    fn recipe_step_serializes_with_defaults() {
        let step = RecipeStep {
            step_id: "diagnose".into(),
            name: "Diagnose Code".into(),
            template: "Find bugs in: {{selection}}".into(),
            provider: Some("gemini".into()),
            model: Some("gemini-2.5-flash-lite".into()),
            api_key: None,
            output_key: "diagnosis".into(),
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("diagnosis"));
        let deserialized: RecipeStep = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.step_id, "diagnose");
    }

    #[test]
    fn run_record_serializes_to_json() {
        let r = RunRecord {
            id: "rec-1".into(),
            session_id: "sess-1".into(),
            turn_index: 0,
            prompt_id: "test-id".into(),
            engine: "gemini".into(),
            input_text: "input".into(),
            final_prompt: "final".into(),
            response: "response".into(),
            duration_ms: 120,
            error: String::new(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("rec-1"));
    }

    #[test]
    fn message_roundtrips_json() {
        let m = Message {
            role: "user".into(),
            content: "hello".into(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let m2: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(m2.role, "user");
        assert_eq!(m2.content, "hello");
    }
}
