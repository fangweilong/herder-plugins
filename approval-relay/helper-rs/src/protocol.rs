//! 与 approval-relay mod 之间的文件协议：queue/<id>.json → answers/<id>.json。
//! 字段与 mods/approval-relay/main.js 的 enqueue 保持一致。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionItem {
    pub label: String,
    #[serde(default)]
    pub keys: Vec<String>,
    #[serde(default)]
    pub selected: bool,
    #[serde(default, rename = "default")]
    pub is_default: bool,
    #[serde(default)]
    pub other: bool,
    #[serde(default)]
    pub hint: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub answered: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub options: Vec<OptionItem>,
    #[serde(default)]
    pub multi: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub app: Option<String>,
    #[serde(default)]
    pub space: Option<String>,
    #[serde(default)]
    pub tab: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub question_count: usize,
    #[serde(default)]
    pub multi_question: bool,
    #[serde(default)]
    pub questions: Vec<Question>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub generic: bool,
    #[serde(default)]
    pub multi: bool,
    #[serde(default)]
    pub submit: String,
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(default)]
    pub current_tab: usize,
    #[serde(default)]
    pub options: Vec<OptionItem>,
    #[serde(default)]
    pub screen: String,
    #[serde(default)]
    pub lang: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub created: u64,
}

/// 取 queue 中最早写入的请求；坏文件跳过。
pub fn next_request(queue: &Path) -> Option<Request> {
    let mut files: Vec<(SystemTime, PathBuf)> = fs::read_dir(queue)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false))
        .filter_map(|entry| {
            let modified = entry.metadata().and_then(|meta| meta.modified()).ok()?;
            Some((modified, entry.path()))
        })
        .collect();
    files.sort_by_key(|(modified, _)| *modified);
    files.iter().find_map(|(_, path)| {
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str(&raw).ok()
    })
}

/// 当前请求是否仍在队列里；mod 已处理（终端里回答）时返回 false。
pub fn request_still_queued(queue: &Path, id: &str) -> bool {
    queue.join(format!("{id}.json")).exists()
}

pub fn remove_queued(queue: &Path, id: &str) {
    let _ = fs::remove_file(queue.join(format!("{id}.json")));
}

/// 原子写 answers：先写 tmp，再替换，避免 mod 读到半个文件。
pub fn write_answer(answers: &Path, answer: &serde_json::Value) {
    let id = answer.get("id").and_then(|v| v.as_str()).unwrap_or("answer");
    write_json(&answers.join(format!("{id}.json")), answer);
}

/// 原子写 JSON：先写 tmp 再替换。
pub fn write_json(path: &Path, value: &serde_json::Value) {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    if fs::write(&tmp, serde_json::to_vec_pretty(value).unwrap_or_default()).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}
