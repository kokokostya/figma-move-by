const DEFAULT_ANGLE = 0;
const DEFAULT_DISTANCE = 10;
const DEFAULT_MOVE_COPY = false;

const MAX_HISTORY = 5;
const BASE_HEIGHT = 148;
const HISTORY_HEIGHT = 56; // margin + 2 rows of pills + gap

async function init() {
  const savedAngle = await figma.clientStorage.getAsync('moveByAngle');
  const savedDistance = await figma.clientStorage.getAsync('moveByDistance');
  const savedMoveCopy = await figma.clientStorage.getAsync('moveByCopy');
  const savedHistory = await figma.clientStorage.getAsync('moveByHistory');

  const history = Array.isArray(savedHistory) ? savedHistory : [];

  figma.showUI(__html__, {
    width: 280,
    height: history.length > 0 ? BASE_HEIGHT + HISTORY_HEIGHT : BASE_HEIGHT,
    title: 'Move by...'
  });

  figma.ui.postMessage({
    type: 'init',
    angle: typeof savedAngle === 'number' ? savedAngle : DEFAULT_ANGLE,
    distance:
      typeof savedDistance === 'number'
        ? savedDistance
        : DEFAULT_DISTANCE,
    moveCopy:
      typeof savedMoveCopy === 'boolean'
        ? savedMoveCopy
        : DEFAULT_MOVE_COPY,
    history
  });
}

init();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'move') {
    const angle = Number(msg.angle) || 0;
    const distance = Number(msg.distance) || 0;
    const moveCopy = Boolean(msg.moveCopy);

    await figma.clientStorage.setAsync('moveByAngle', angle);
    await figma.clientStorage.setAsync('moveByDistance', distance);
    await figma.clientStorage.setAsync('moveByCopy', moveCopy);

    // Update history: deduplicate, prepend, cap at MAX_HISTORY
    const savedHistory = await figma.clientStorage.getAsync('moveByHistory');
    const history = Array.isArray(savedHistory) ? savedHistory : [];
    const updated = [
      { angle, distance },
      ...history.filter(h => !(h.angle === angle && h.distance === distance))
    ].slice(0, MAX_HISTORY);
    await figma.clientStorage.setAsync('moveByHistory', updated);

    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.notify('Please select at least one object.');
      figma.closePlugin();
      return;
    }

    // 0° = up
    // 90° = right
    // Convert to Cartesian coordinates
    const radians = ((angle - 90) * Math.PI) / 180;

    const dx = Math.cos(radians) * distance;
    const dy = Math.sin(radians) * distance;

    const movedNodes = [];

    for (const node of selection) {
      if (!('x' in node) || !('y' in node)) {
        continue;
      }

      let target = node;

      if (moveCopy) {
        if ('clone' in node && typeof node.clone === 'function') {
          target = node.clone();

          // clone() places the copy at the page level regardless of where
          // the original lives. Re-parent it into the original's container,
          // right above the original in z-order.
          const originalParent = node.parent;
          if (originalParent && 'insertChild' in originalParent) {
            const index = originalParent.children.indexOf(node);
            originalParent.insertChild(index + 1, target);
          }

          // Now that clone and original share the same parent,
          // x/y are in the same coordinate space — direct assignment works.
          target.x = node.x;
          target.y = node.y;
        } else {
          continue;
        }
      }

      target.x += dx;
      target.y += dy;

      movedNodes.push(target);
    }

    if (moveCopy) {
      figma.currentPage.selection = movedNodes;
    }

    figma.notify(
      `${moveCopy ? 'Created and moved' : 'Moved'} ${
        movedNodes.length
      } object${movedNodes.length === 1 ? '' : 's'}.`
    );

    figma.closePlugin();
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
