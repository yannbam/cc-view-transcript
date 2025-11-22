#!/bin/bash
# Extract all important content from a Claude Code session transcript
# Usage: ./extract_all.sh <session-id-or-jsonl-file>

if [ -z "$1" ]; then
    echo "Usage: $0 <session-id-or-jsonl-file>"
    exit 1
fi

# Determine if input is a file or session ID
if [ -f "$1" ]; then
    TRANSCRIPT="$1"
else
    # Find transcript file for this session ID
    TRANSCRIPT=$(find ~/.claude/projects -name "$1.jsonl" 2>/dev/null | head -1)
    if [ -z "$TRANSCRIPT" ]; then
        echo "Error: Could not find transcript for session $1"
        exit 1
    fi
fi

echo "=== Parsing: $TRANSCRIPT ==="
echo ""

# Parse with jq
cat "$TRANSCRIPT" | jq -s '
# Add sequential index to track order
to_entries[] |

# Extract different content types
if .value.type == "assistant" then
  .value.message.content[] |
  if .type == "thinking" then
    {
      type: "🐱💭 THINKING",
      content: .thinking
    }
  elif .type == "text" then
    {
      type: "🐱💬 CLAUDE",
      content: .text
    }
  elif .type == "tool_use" then
    {
      type: "🔧 TOOL_CALL",
      tool: .name,
      id: .id,
      input: .input
    }
  else
    empty
  end
elif .value.type == "user" then
  if .value.message.content | type == "string" then
    {
      type: "👤 HUMAN",
      content: .value.message.content
    }
  else
    .value.message.content[] |
    if .type == "tool_result" then
      {
        type: (if .is_error then "❌ TOOL_ERROR" else "✅ TOOL_RESULT" end),
        id: .tool_use_id,
        content: (if .content then (.content | if type == "array" then .[0].text else . end) else null end)
      }
    else
      empty
    end
  end
else
  empty
end
' | jq -r '
# Format output nicely
if .type == "🐱💭 THINKING" then
  "\n● " + .type + "\n" + ("—" * 40) + "\n" + .content + "\n"
elif .type == "🐱💬 CLAUDE" then
  "\n● " + .type + "\n" + ("—" * 40) + "\n" + .content + "\n"
elif .type == "👤 HUMAN" then
  "\n" + .type + "\n" + ("—" * 40) + "\n" + .content + "\n"
elif .type == "🔧 TOOL_CALL" then
  "\n● " + .type + ": " + .tool + "\n" + ("—" * 40) + "\nID: " + .id + "\nInput: " + (.input | tostring) + "\n"
elif .type == "✅ TOOL_RESULT" or .type == "❌ TOOL_ERROR" then
  "\n● " + .type + "\n" + ("—" * 40) + "\nID: " + .id + "\n" + (.content // "null") + "\n"
else
  ""
end
'
