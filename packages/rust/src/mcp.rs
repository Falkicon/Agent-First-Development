//! Model Context Protocol (MCP) types.
//!
//! MCP is a JSON-RPC based protocol used by AFD for agent tooling surfaces.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::commands::McpTool;

static REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// MCP JSON-RPC request/response identifier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum McpId {
    /// Numeric request identifier.
    Number(u64),
    /// String request identifier.
    String(String),
}

impl From<u64> for McpId {
    fn from(value: u64) -> Self {
        Self::Number(value)
    }
}

impl From<u32> for McpId {
    fn from(value: u32) -> Self {
        Self::Number(value.into())
    }
}

impl From<i32> for McpId {
    fn from(value: i32) -> Self {
        Self::Number(value.max(0) as u64)
    }
}

impl From<&str> for McpId {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<String> for McpId {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

/// MCP JSON-RPC request format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpRequest {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Request ID for correlation.
    pub id: McpId,
    /// Method being called.
    pub method: String,
    /// Optional parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<HashMap<String, serde_json::Value>>,
}

/// MCP JSON-RPC response format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResponse {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Request ID this is responding to.
    pub id: McpId,
    /// Result if successful.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// Error if failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

/// MCP error format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpError {
    /// Error code.
    pub code: i32,
    /// Human-readable error message.
    pub message: String,
    /// Additional error data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// MCP error code type alias.
pub type McpErrorCode = i32;

/// Standard MCP and JSON-RPC error codes.
pub struct McpErrorCodes;

impl McpErrorCodes {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    pub const SERVER_NOT_INITIALIZED: i32 = -32002;
    pub const REQUEST_CANCELLED: i32 = -32800;
    pub const CONTENT_MODIFIED: i32 = -32801;
}

/// MCP notification format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpNotification {
    /// JSON-RPC version, always `2.0`.
    pub jsonrpc: String,
    /// Notification method.
    pub method: String,
    /// Optional parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<HashMap<String, serde_json::Value>>,
}

/// MCP tools/list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsListResult {
    /// Available MCP tools.
    pub tools: Vec<McpTool>,
}

/// MCP tools/call request params.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallParams {
    /// Tool name.
    pub name: String,
    /// Tool arguments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<HashMap<String, serde_json::Value>>,
}

/// MCP tools/call response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    /// Returned content chunks.
    pub content: Vec<McpContent>,
    /// Whether the result represents an error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// Embedded MCP resource payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpEmbeddedResource {
    /// Resource URI.
    pub uri: String,
    /// Resource MIME type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Text payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Blob payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

/// MCP text content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpTextContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

/// MCP image content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpImageContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub data: String,
    pub mime_type: String,
}

/// MCP resource content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub resource: McpEmbeddedResource,
}

/// MCP content union.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum McpContent {
    Text(McpTextContent),
    Image(McpImageContent),
    Resource(McpResourceContent),
}

/// Tool capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Resource capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpResourcesCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Prompt capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// Roots capability metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpRootsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

/// MCP server capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<McpToolsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<McpResourcesCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<McpPromptsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<HashMap<String, serde_json::Value>>,
}

/// MCP client capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<McpRootsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<HashMap<String, serde_json::Value>>,
}

/// MCP peer info.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPeerInfo {
    pub name: String,
    pub version: String,
}

/// MCP initialize request params.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpInitializeParams {
    pub protocol_version: String,
    pub capabilities: McpClientCapabilities,
    pub client_info: McpPeerInfo,
}

/// MCP initialize response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpInitializeResult {
    pub protocol_version: String,
    pub capabilities: McpServerCapabilities,
    pub server_info: McpPeerInfo,
}

/// Create an MCP request with an auto-incrementing ID.
pub fn create_mcp_request(
    method: &str,
    params: Option<HashMap<String, serde_json::Value>>,
) -> McpRequest {
    McpRequest {
        jsonrpc: "2.0".to_string(),
        id: McpId::Number(REQUEST_ID.fetch_add(1, Ordering::SeqCst) + 1),
        method: method.to_string(),
        params,
    }
}

/// Create an MCP success response.
pub fn create_mcp_response(
    id: impl Into<McpId>,
    result: impl Into<serde_json::Value>,
) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id: id.into(),
        result: Some(result.into()),
        error: None,
    }
}

/// Create an MCP error response.
pub fn create_mcp_error_response(
    id: impl Into<McpId>,
    code: McpErrorCode,
    message: &str,
    data: Option<serde_json::Value>,
) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id: id.into(),
        result: None,
        error: Some(McpError {
            code,
            message: message.to_string(),
            data,
        }),
    }
}

/// Create a text content item.
pub fn text_content(text: &str) -> McpTextContent {
    McpTextContent {
        content_type: "text".to_string(),
        text: text.to_string(),
    }
}

/// Type guard for MCP requests.
pub fn is_mcp_request<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && json.get("id").is_some()
            && matches!(json.get("method"), Some(serde_json::Value::String(_)))
    } else {
        false
    }
}

/// Type guard for MCP responses.
pub fn is_mcp_response<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && json.get("id").is_some()
            && (json.get("result").is_some() || json.get("error").is_some())
    } else {
        false
    }
}

/// Type guard for MCP notifications.
pub fn is_mcp_notification<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("jsonrpc") == Some(&serde_json::json!("2.0"))
            && matches!(json.get("method"), Some(serde_json::Value::String(_)))
            && json.get("id").is_none()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_mcp_request() {
        let req1 = create_mcp_request("tools/list", None);
        let req2 = create_mcp_request("tools/call", None);

        assert_eq!(req1.jsonrpc, "2.0");
        assert_eq!(req1.method, "tools/list");
        assert!(matches!(req2.id, McpId::Number(_)));
        assert_ne!(req1.id, req2.id);
    }

    #[test]
    fn test_create_mcp_response() {
        let res = create_mcp_response(1u32, serde_json::json!({ "data": "hello" }));
        assert_eq!(res.jsonrpc, "2.0");
        assert_eq!(res.id, McpId::Number(1));
        assert_eq!(res.result, Some(serde_json::json!({ "data": "hello" })));
        assert!(res.error.is_none());
    }

    #[test]
    fn test_create_mcp_error_response() {
        let res = create_mcp_error_response(
            1u32,
            McpErrorCodes::METHOD_NOT_FOUND,
            "Method not found",
            None,
        );
        assert_eq!(res.id, McpId::Number(1));
        assert!(res.result.is_none());
        assert_eq!(
            res.error,
            Some(McpError {
                code: McpErrorCodes::METHOD_NOT_FOUND,
                message: "Method not found".to_string(),
                data: None,
            })
        );
    }

    #[test]
    fn test_text_content() {
        let content = text_content("hello world");
        assert_eq!(content.content_type, "text");
        assert_eq!(content.text, "hello world");
    }

    #[test]
    fn test_is_mcp_request() {
        assert!(is_mcp_request(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "test" })
        ));
        assert!(!is_mcp_request(
            &serde_json::json!({ "jsonrpc": "1.0", "id": 1, "method": "test" })
        ));
    }

    #[test]
    fn test_is_mcp_response() {
        assert!(is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": {} })
        ));
        assert!(is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -1, "message": "err" } })
        ));
        assert!(!is_mcp_response(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1 })
        ));
    }

    #[test]
    fn test_is_mcp_notification() {
        assert!(is_mcp_notification(
            &serde_json::json!({ "jsonrpc": "2.0", "method": "notify" })
        ));
        assert!(!is_mcp_notification(
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "notify" })
        ));
    }
}
