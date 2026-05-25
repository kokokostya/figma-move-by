const DEFAULT_ANGLE = 0;
const DEFAULT_DISTANCE = 10;
const DEFAULT_MOVE_COPY = false;

const MAX_HISTORY = 5;
const UI_WIDTH = 400;
const INITIAL_UI_HEIGHT = 148;
const PREVIEW_OPACITY = 0.35;

let previewNodes = [];
let lastPreview = {
  angle: DEFAULT_ANGLE,
  distance: DEFAULT_DISTANCE
};

function getMoveDelta(angle, distance) {
  // 0° = up, 90° = right. Convert to Cartesian coordinates.
  const radians = ((angle - 90) * Math.PI) / 180;

  return {
    dx: Math.cos(radians) * distance,
    dy: Math.sin(radians) * distance
  };
}

function canMoveNode(node) {
  return 'x' in node && 'y' in node;
}

function cloneIntoOriginalParent(node) {
  if (!('clone' in node) || typeof node.clone !== 'function') {
    return null;
  }

  const clone = node.clone();
  const originalParent = node.parent;

  if (originalParent && 'insertChild' in originalParent) {
    const index = originalParent.children.indexOf(node);
    originalParent.insertChild(index + 1, clone);
  }

  clone.x = node.x;
  clone.y = node.y;

  return clone;
}

function removePreview() {
  for (const node of previewNodes) {
    if (node.removed) {
      continue;
    }

    node.remove();
  }

  previewNodes = [];
}

function renderPreview(angle, distance) {
  lastPreview = { angle, distance };
  removePreview();

  const { dx, dy } = getMoveDelta(angle, distance);

  for (const node of figma.currentPage.selection) {
    if (!canMoveNode(node)) {
      continue;
    }

    const preview = cloneIntoOriginalParent(node);

    if (!preview) {
      continue;
    }

    preview.x += dx;
    preview.y += dy;
    preview.name = `[Move by preview] ${node.name}`;

    if ('opacity' in preview) {
      preview.opacity *= PREVIEW_OPACITY;
    }

    if ('locked' in preview) {
      preview.locked = true;
    }

    previewNodes.push(preview);
  }
}

async function init() {
  const savedAngle = await figma.clientStorage.getAsync('moveByAngle');
  const savedDistance = await figma.clientStorage.getAsync('moveByDistance');
  const savedMoveCopy = await figma.clientStorage.getAsync('moveByCopy');
  const savedHistory = await figma.clientStorage.getAsync('moveByHistory');

  const history = Array.isArray(savedHistory) ? savedHistory : [];

  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: INITIAL_UI_HEIGHT,
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
    history,
    hasSelection: figma.currentPage.selection.length > 0
  });
}

init();

figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection-state',
    hasSelection: figma.currentPage.selection.length > 0
  });
  renderPreview(lastPreview.angle, lastPreview.distance);
});

figma.on('close', () => {
  removePreview();
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'resize-ui') {
    const height = Math.max(1, Math.ceil(Number(msg.height) || 0));
    figma.ui.resize(UI_WIDTH, height);
    return;
  }

  if (msg.type === 'preview') {
    const angle = Number(msg.angle) || 0;
    const distance = Number(msg.distance) || 0;

    renderPreview(angle, distance);
    return;
  }

  if (msg.type === 'remove-history') {
    const angle = Number(msg.angle) || 0;
    const distance = Number(msg.distance) || 0;
    const savedHistory = await figma.clientStorage.getAsync('moveByHistory');
    const history = Array.isArray(savedHistory) ? savedHistory : [];
    const updated = history.filter(
      item => !(item.angle === angle && item.distance === distance)
    );

    await figma.clientStorage.setAsync('moveByHistory', updated);
    return;
  }

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

    removePreview();

    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.notify('Please select at least one object.');
      figma.closePlugin();
      return;
    }

    const { dx, dy } = getMoveDelta(angle, distance);

    const movedNodes = [];

    for (const node of selection) {
      if (!('x' in node) || !('y' in node)) {
        continue;
      }

      let target = node;

      if (moveCopy) {
        target = cloneIntoOriginalParent(node);

        if (!target) {
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
    removePreview();
    figma.closePlugin();
  }
};
