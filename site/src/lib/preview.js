// When you open a game from a list, the list already knows its name and icon.
// Links carry those along (React Router's link "state"), so the game page can
// show them instantly while its live numbers load, instead of a blank skeleton.

/** The state to put on a link to a game's page. */
export const previewState = (game) => ({
  preview: { universeId: game.universeId, name: game.name, icon: game.icon ?? null, creatorName: game.creatorName ?? null },
});

/** The preview a link carried for this game, if any. */
export function readPreview(location, universeId) {
  const preview = location.state?.preview;
  return preview && String(preview.universeId) === String(universeId) ? preview : null;
}
