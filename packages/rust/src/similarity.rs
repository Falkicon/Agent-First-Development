//! String similarity utilities for fuzzy matching.

/// Calculate similarity between two strings using Levenshtein distance.
/// Returns a value between 0 and 1.
pub fn calculate_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    let a_chars: Vec<char> = a_lower.chars().collect();
    let b_chars: Vec<char> = b_lower.chars().collect();

    let mut matrix = vec![vec![0usize; b_chars.len() + 1]; a_chars.len() + 1];

    for (i, row) in matrix.iter_mut().enumerate() {
        row[0] = i;
    }

    for j in 0..=b_chars.len() {
        matrix[0][j] = j;
    }

    for i in 1..=a_chars.len() {
        for j in 1..=b_chars.len() {
            let cost = usize::from(a_chars[i - 1] != b_chars[j - 1]);
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    let max_len = a_chars.len().max(b_chars.len());
    let distance = matrix[a_chars.len()][b_chars.len()];

    if max_len == 0 {
        1.0
    } else {
        1.0 - (distance as f64 / max_len as f64)
    }
}

/// Find similar tool names for suggestions.
pub fn find_similar_tools(
    requested_tool: &str,
    available_tools: &[String],
    max_suggestions: Option<usize>,
) -> Vec<String> {
    let max_suggestions = max_suggestions.unwrap_or(3);
    let mut scored: Vec<(String, f64)> = available_tools
        .iter()
        .map(|tool| (tool.clone(), calculate_similarity(requested_tool, tool)))
        .filter(|(_, similarity)| *similarity >= 0.4)
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored
        .into_iter()
        .take(max_suggestions)
        .map(|(tool, _)| tool)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_similarity() {
        assert_eq!(calculate_similarity("hello", "hello"), 1.0);
        assert_eq!(calculate_similarity("Hello", "hello"), 1.0);
        assert!(calculate_similarity("abc", "xyz") < 0.4);
        assert_eq!(calculate_similarity("", ""), 1.0);
        assert_eq!(calculate_similarity("hello", ""), 0.0);
    }

    #[test]
    fn test_find_similar_tools() {
        let tools = vec![
            "todo-create".to_string(),
            "todo-list".to_string(),
            "user-get".to_string(),
        ];

        let suggestions = find_similar_tools("todo-crate", &tools, None);
        assert_eq!(suggestions[0], "todo-create");

        let none = find_similar_tools("zzzzzzz", &tools, None);
        assert!(none.is_empty());
    }
}
