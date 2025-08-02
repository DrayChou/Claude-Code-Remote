# Data Directory Structure

This directory contains runtime data files for the Claude Code Remote system.

## Directory Structure

```
src/data/
├── .gitkeep                          # Preserves directory structure in git
├── session-map.json                  # Active session tokens (IGNORED)
├── processed-messages.json           # Processed message IDs (IGNORED)
├── subagent-activities.json          # Agent activity logs (IGNORED)
├── sessions/                         # Individual session files (IGNORED)
│   ├── .gitkeep                     # Preserves directory structure
│   └── *.json                       # Session files with tokens (IGNORED)
├── tmux-captures/                    # Tmux session captures (IGNORED)
│   └── .gitkeep                     # Preserves directory structure
└── *.example.json                    # Template files (TRACKED)
```

## File Types

### Runtime Data (Ignored by Git)
- **session-map.json**: Maps 8-character tokens to session metadata
- **processed-messages.json**: Tracks processed email/message IDs to prevent duplicates
- **subagent-activities.json**: Records agent activities and states
- **sessions/*.json**: Individual session files containing tokens and configuration
- **tmux-captures/**: Directory for tmux session capture files

### Template Files (Tracked by Git)
- ***.example.json**: Example file structures for documentation

## Security Notes

All runtime data files contain sensitive information including:
- Session tokens
- User chat IDs
- Working directory paths
- Bot configuration

These files are automatically ignored by git to prevent accidental exposure of sensitive data.

## File Creation

The system automatically creates and manages these files:
- Files are created when sessions are established
- Old sessions are cleaned up automatically after expiration (24 hours)
- Empty files will be created with default structures if missing