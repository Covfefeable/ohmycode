# Workspace snapshots

Desktop captures a workspace baseline before starting a Turn and a checkpoint
when it settles. This covers both built-in patches and terminal commands. A
terminal which outlives the Turn keeps its record active; its exit triggers a
final capture. The conversation header's Workspace changes button lists local
records, previews text diffs, and restores individual files after confirmation.
Each Turn group shows its original user request from the local Runtime journal,
with a single-line ellipsis, full-text tooltip and timestamp. Its Restore all
action restores only that Turn's remaining files. All selected files are checked
for conflicts before the batch starts. Each completed file is recorded separately
if a later I/O error interrupts the batch; this is not a filesystem transaction.

## Storage and boundaries

Following OpenCode's Snapshot/SessionRevert separation, content lives in a
private Git object database under Electron userData, while Turn associations
live in atomically replaced JSON records. Stores are isolated by API URL and
account. Each workspace has its own bare repository and index. Snapshot refs
pin the before/after trees. No operation changes the user's index, HEAD,
branches or commits. Raw blobs preserve bytes without running Git filters;
Git builds and compares directory trees. Git hooks and fsmonitor are disabled.
Git long-path support is enabled for Windows application-data paths. Reference
pinning failures mark the snapshot unavailable without rejecting chat preparation.

This first version requires an installed Git executable and a Git workspace.
It protects existing uncommitted and untracked files selected by Git's file
enumeration. It skips ignored untracked files, dependencies/build output,
`.env*`, private-key extensions, symbolic links and submodules. Individual
files over 2 MiB are listed as excluded. Captures exceeding 20,000 candidate
paths or 256 MiB fail visibly rather than claiming complete protection.
These exclusions are not a general-purpose secret detector.

## Restore

Restore checks that the current bytes and executable bit still match the saved
after-version. Added files are removed, deleted files restored, and modified
files replaced with their baseline contents. A changed or occupied path is a
conflict. Symlink files and parents are rejected. Binary restoration preserves
bytes, although the text preview rejects binary content.

The renderer supplies only a conversation, record ID and recorded relative path
through typed IPC. The main process authenticates conversation access and
resolves content from the account-scoped store. Restores are serialized with
snapshot captures. All restores are blocked while any local Turn, terminal, or
restore is active, and new Turns cannot start during restoration.

## Limits of this version

- Snapshots describe workspace state, not proven authorship. Concurrent editor
  or agent edits can appear in the same change set. A scan is not an atomic
  filesystem snapshot. Version checks cannot lock external editors.
- Only the selected workspace is covered; terminal writes elsewhere and
  detached subprocesses are not tracked. Empty directories are not stored.
- Restoring files does not rewind conversation history or model context.
- Active records left by a process crash are not automatically restored or
  re-baselined; their final state is uncertain. Completed records survive restart.
- Restoration is file-level, not an atomic multi-file transaction. A crash
  between a file write and metadata settlement can leave an uncertain result;
  later mismatches are refused instead of blindly retrying the write.
- Retention/garbage collection and Worktree isolation are not implemented yet.
  Snapshots consume local disk space and remain until their store is removed.

## Verification

`pnpm --dir desktop test:file-tools` runs real Git regression tests for dirty
baselines, terminal edits, additions/deletions, unchanged user index/HEAD,
conflicts, binary bytes, exclusions, account-facing thread checks, symlinks and
completed-record reload. UI tests cover preview, confirmation, running-task
disablement and conflict feedback.
