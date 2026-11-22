/**
 * Locate, back up, and rewrite the active profile's patch file.
 *
 * ## Which file
 *
 * A dsh profile keeps its hand-written layer at
 * `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`. `DSH_HOME` defaults to
 * `~/.dsh`; the profile defaults to `web`. The plugin never guesses a path
 * that does not exist — an absent patch file is reported, not created, because
 * the file is the user's own layer and a plugin has no business minting one.
 *
 * ## How safely
 *
 * Every write is preceded by a timestamped copy beside the original, and the
 * bytes are written through a rename so a crash mid-write leaves the original
 * intact. The rendered text is re-parsed through the same pipeline before it
 * replaces anything: a document that does not round-trip is refused, which
 * catches the one failure mode that would be invisible — a silent shape change.
 *
 * @module src/store
 */
/** Where the active patch file lives and whether it is writable. */
export interface PatchLocation {
    file: string;
    exists: boolean;
}
/**
 * Resolve the patch file for one profile.
 *
 * @param home - `DSH_HOME`, or `undefined` to use `~/.dsh`.
 * @param profile - the profile name, `web` by default.
 */
export declare function resolvePatchFile(home: string | undefined, profile: string): PatchLocation;
/**
 * Read the patch text; refuses rather than inventing an empty document.
 *
 * The `exists` flag on {@link PatchLocation} is a snapshot taken when the path
 * was resolved, and it goes stale the moment anything creates or removes the
 * file. Trusting it would report a file that is right there as missing (and,
 * worse, miss one that just appeared), so existence is decided by the read
 * itself and its own error carries the explanation.
 */
export declare function readPatch(location: PatchLocation): string;
/** A backup copy written immediately before one apply. */
export interface Backup {
    file: string;
    bytes: number;
}
/**
 * Suffix every backup this plugin writes carries.
 *
 * A profile directory collects backups from many sources, and a bare
 * `.bak-<stamp>` says nothing about who made it — which made it impossible to
 * tell this plugin's copies from a hand edit's or another plugin's. The marker
 * also gives retention something to match on: only files with it are pruned,
 * and pruning never touches a backup someone else wrote.
 */
export declare const BACKUP_MARKER = "bak-model-capability-alignment-";
/** How many of this plugin's backups to keep beside the patch. */
export declare const BACKUP_KEEP = 5;
/**
 * Write a timestamped copy of the patch beside itself.
 *
 * The stamp makes repeated applies distinguishable, and the copy lives in the
 * same directory as the original so a user finds both together.
 *
 * @param location - the file to copy.
 * @param text - its current contents.
 * @param now - injectable clock, for tests.
 */
export declare function backupPatch(location: PatchLocation, text: string, now?: Date): Backup;
/**
 * Keep only the newest `keep` backups this plugin wrote.
 *
 * Sorted by the timestamp in the name (the same fixed-shape stamp every file
 * carries, so lexical order is chronological), and only files whose name holds
 * {@link BACKUP_MARKER} are candidates — another writer's backups stay put.
 * A failure here never fails the apply: the write already succeeded and a
 * leftover file is harmless, while throwing would misreport a good write.
 *
 * @param patchFile - the profile patch the backups sit beside.
 * @param keep - how many to retain.
 * @returns the files removed.
 */
export declare function pruneBackups(patchFile: string, keep?: number): string[];
/**
 * Replace the patch file's contents atomically.
 *
 * Writes a sibling temporary file and renames it over the original: on the
 * same filesystem `rename` is atomic, so a reader sees either the old bytes or
 * the new ones and never a half-written file.
 *
 * @param location - the file to replace.
 * @param text - the rendered document.
 */
export declare function writePatch(location: PatchLocation, text: string): void;
