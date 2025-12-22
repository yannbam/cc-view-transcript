# cc-view-transcript

CLI tool for viewing Claude Code session transcripts in human-readable format.

## Installation

```bash
# Clone and make executable
chmod +x cc-view-transcript.js

# Optionally add to PATH or create alias
ln -s $(pwd)/cc-view-transcript.js ~/bin/cc-view-transcript
```

## Usage

```
cc-view-transcript <session-refs...> [options]
```

### Session References

The tool accepts multiple flexible session references:

| Input Type | Example | Description |
|------------|---------|-------------|
| Session ID prefix | `abc123` | Finds sessions starting with this prefix |
| Full UUID | `4eea8d85-c8b7-4da3-...` | Exact session match |
| File path | `./session.jsonl` | Direct path to transcript file |
| Directory | `.` or `/path/to/project` | Lists sessions for that project |

### Options

```
-h, --help           Show help message
--no-thinking        Hide Claude's thinking blocks
--no-tools           Hide tool calls and results
--no-metadata        Hide session metadata header
--truncate           Truncate long content
--max-length <n>     Max length for truncated content (default: 500)
--show-system        Show system messages (hidden by default)
--no-timestamps      Hide timestamps from headers
--include-agents     Include agent sessions in listings
--latest             Auto-select most recent session
```

### Examples

```bash
# View session by prefix (auto-selects if unique match)
cc-view-transcript 4eea

# View most recent session in current project
cc-view-transcript . --latest

# View multiple sessions
cc-view-transcript abc123 def456 ghi789

# List all sessions for current project with agents
cc-view-transcript . --include-agents

# Compact view without thinking blocks
cc-view-transcript 4eea --no-thinking --no-tools

# Direct file path
cc-view-transcript ~/.claude/projects/-home-jan-myproject/session.jsonl
```

## Session Resolution

When given a prefix or directory:

1. **Unique match** → Opens that session
2. **Multiple matches** → Shows candidate list with:
   - Session ID
   - Project directory (encoded)
   - Last modified date
   - File size
   - Agent sessions (with `--include-agents`)

Use `--latest` to auto-pick the most recently modified session.

## Output Format

The transcript displays:
- **Session metadata** - ID, project path, timestamps, message counts
- **Human messages** - User input
- **Claude responses** - Text output
- **Thinking blocks** - Claude's reasoning (optional)
- **Tool calls** - Tool name, ID, input
- **Tool results** - Output, errors, status

## File Locations

Claude Code stores sessions in:
```
~/.claude/projects/<encoded-project-path>/
├── <uuid>.jsonl           # Main sessions
└── agent-<id>.jsonl       # Sub-agent sessions
```

Project paths are encoded by replacing non-alphanumeric characters with hyphens:
- `/home/jan/my-project` → `-home-jan-my-project`
