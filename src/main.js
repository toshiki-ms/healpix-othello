import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BLACK,
  EMPTY,
  WHITE,
  applyMove,
  chooseAiMove,
  countPieces,
  createInitialState,
  passTurn,
  validMoves
} from "./game.js";
import { HEALPIX_BOUNDARY_SEGMENTS_NSIDE2 } from "./healpix-boundaries-nside2.js";
import { createHealpixTopology, pixelCount } from "./healpix.js";

const topology = createHealpixTopology(2);
const canvas = document.querySelector("#board");
const resolutionLabel = document.querySelector("#resolutionLabel");
const blackScore = document.querySelector("#blackScore");
const whiteScore = document.querySelector("#whiteScore");
const turnLabel = document.querySelector("#turnLabel");
const message = document.querySelector("#message");
const blackNpcToggle = document.querySelector("#blackNpcToggle");
const whiteNpcToggle = document.querySelector("#whiteNpcToggle");
const passButton = document.querySelector("#passButton");
const resetButton = document.querySelector("#resetButton");
const netBoard = document.querySelector("#netBoard");
const netPanel = document.querySelector(".net-panel");
const axisWidget = document.querySelector("#axisWidget");
const axisWidgetItems = [
  {
    line: document.querySelector("#axisLineX"),
    text: document.querySelector("#axisTextX"),
    direction: new THREE.Vector3(1, 0, 0),
    fallback: new THREE.Vector2(48, 0),
    halfWidth: 16
  },
  {
    line: document.querySelector("#axisLineY"),
    text: document.querySelector("#axisTextY"),
    direction: new THREE.Vector3(0, 1, 0),
    fallback: new THREE.Vector2(-38, -34),
    halfWidth: 16
  },
  {
    line: document.querySelector("#axisLineZ"),
    text: document.querySelector("#axisTextZ"),
    direction: new THREE.Vector3(0, 0, 1),
    fallback: new THREE.Vector2(12, -46),
    halfWidth: 31
  },
  {
    line: document.querySelector("#axisLineSouth"),
    text: null,
    direction: new THREE.Vector3(0, 0, -1),
    fallback: new THREE.Vector2(-12, 48),
    halfWidth: 31
  }
];
const axisWidgetRotation = new THREE.Quaternion();
const axisWidgetDirection = new THREE.Vector3();
const godHintButton = document.querySelector("#godHintButton");
const difficultyButtons = [...document.querySelectorAll("[data-player][data-difficulty]")];

const colors = {
  baseTile: new THREE.Color("#5f6768"),
  alternateTile: new THREE.Color("#50595a"),
  legalBlack: new THREE.Color("#4db996"),
  legalWhite: new THREE.Color("#d8b442"),
  hover: new THREE.Color("#c96542"),
  last: new THREE.Color("#9e6fef"),
  hint: new THREE.Color("#f052be"),
  locator: new THREE.Color("#fff4a8"),
  blackPiece: new THREE.Color("#08090a"),
  whitePiece: new THREE.Color("#eeeae0")
};

let state = createInitialState(topology);
let legalMoves = new Map();
let hoveredCellId = null;
let focusCellId = null;
let npcPlayers = new Set([WHITE]);
let aiDifficulties = {
  [BLACK]: "easy",
  [WHITE]: "easy"
};
let aiTimer = 0;
let hintMoveId = null;
let hintBusy = false;
let hintToken = 0;
let pointerDown = null;
let hasCameraFocusTarget = false;
let focusHoldUntil = 0;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance"
});
renderer.setClearColor(0x363b3d, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x363b3d, 4.1, 7.6);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0.2, 0.36, 3.35);
const cameraFocusTarget = new THREE.Vector3();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.15;
controls.maxDistance = 6.2;
controls.rotateSpeed = 0.62;
controls.zoomSpeed = 0.55;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.28;

const ambient = new THREE.HemisphereLight(0xf8f3de, 0x16191c, 2.2);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2.8, 2.2, 3.2);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x67c9b0, 0.82);
rimLight.position.set(-3.4, -0.4, -2.6);
scene.add(rimLight);

const globe = new THREE.Mesh(
  new THREE.SphereGeometry(0.984, 72, 36),
  new THREE.MeshStandardMaterial({
    color: 0x3f4648,
    roughness: 0.94,
    metalness: 0,
    transparent: true,
    opacity: 0.88
  })
);
scene.add(globe);

const healpixBoundaryGroup = new THREE.Group();
scene.add(healpixBoundaryGroup);

const tileGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(tileGroup, pieceGroup);

const unitZ = new THREE.Vector3(0, 0, 1);
const unitY = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tileMeshes = new Map();
const netCellGroups = new Map();
const tileGeometry = new THREE.PlaneGeometry(1, 1);
const pieceGeometry = new THREE.CylinderGeometry(1, 1, 0.12, 36, 1);
const locatorMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.84, 1, 48),
  new THREE.MeshBasicMaterial({
    color: colors.locator,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true
  })
);
locatorMarker.visible = false;
locatorMarker.renderOrder = 4;
scene.add(locatorMarker);

buildHealpixBoundaries();
buildTiles();
buildNet();
resize();
updatePlayerButtons();
updateDifficultyButtons();
refresh();
requestAiIfNeeded();
renderer.setAnimationLoop(render);

window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointerleave", clearHover);
blackNpcToggle.addEventListener("click", () => toggleNpc(BLACK));
whiteNpcToggle.addEventListener("click", () => toggleNpc(WHITE));
passButton.addEventListener("click", requestPass);
resetButton.addEventListener("click", resetGame);
godHintButton.addEventListener("click", requestGodHint);
difficultyButtons.forEach((button) => button.addEventListener("click", setDifficulty));

function buildHealpixBoundaries() {
  healpixBoundaryGroup.clear();

  const radius = 1.054;
  const positions = new Float32Array(HEALPIX_BOUNDARY_SEGMENTS_NSIDE2.length);
  for (let index = 0; index < HEALPIX_BOUNDARY_SEGMENTS_NSIDE2.length; index += 1) {
    positions[index] = HEALPIX_BOUNDARY_SEGMENTS_NSIDE2[index] * radius;
  }

  const material = new THREE.LineBasicMaterial({
    color: 0xf4ecd6,
    transparent: true,
    opacity: 0.58,
    depthTest: true
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const lineSegments = new THREE.LineSegments(geometry, material);
  lineSegments.renderOrder = 2;
  healpixBoundaryGroup.add(lineSegments);
}

function buildTiles() {
  tileGroup.clear();
  tileMeshes.clear();
  for (const cell of topology.cells) {
    const material = new THREE.MeshStandardMaterial({
      color: baseColorFor(cell),
      roughness: 0.68,
      metalness: 0.03,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(tileGeometry, material);
    const normal = vectorForCell(cell);
    const size = tileSize(cell);

    mesh.position.copy(normal).multiplyScalar(1.02);
    mesh.quaternion.setFromUnitVectors(unitZ, normal);
    mesh.scale.set(size * 1.12, size * 0.9, 1);
    mesh.userData.cellId = cell.id;

    tileGroup.add(mesh);
    tileMeshes.set(cell.id, mesh);
  }
}

function buildNet() {
  const namespace = "http://www.w3.org/2000/svg";
  netBoard.setAttribute("viewBox", `-1 0.35 ${8 * topology.nside + 2} ${4 * topology.nside - 0.7}`);
  netBoard.replaceChildren();
  netCellGroups.clear();

  const sortedCells = [...topology.cells].sort((a, b) => a.gridJr - b.gridJr || a.gridJp - b.gridJp);
  for (const cell of sortedCells) {
    const group = document.createElementNS(namespace, "g");
    const shape = document.createElementNS(namespace, "polygon");
    const piece = document.createElementNS(namespace, "circle");
    const x = cell.gridJp;
    const y = cell.gridJr;
    const radius = 0.46;

    group.classList.add("net-cell");
    group.dataset.cellId = String(cell.id);
    shape.classList.add("net-cell-shape");
    shape.setAttribute(
      "points",
      `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`
    );
    piece.classList.add("net-piece");
    piece.setAttribute("cx", String(x));
    piece.setAttribute("cy", String(y));
    piece.setAttribute("r", "0.22");

    group.append(shape, piece);
    group.addEventListener("pointerenter", () => {
      hoveredCellId = cell.id;
      focusCellId = cell.id;
      refresh();
    });
    group.addEventListener("pointerleave", () => {
      if (hoveredCellId === cell.id) {
        hoveredCellId = null;
        refresh();
      }
    });
    group.addEventListener("click", () => {
      focusCellId = cell.id;
      nudgeCameraTowardCell(cell.id);
      if (!state.gameOver && !isNpcTurn()) {
        playCell(cell.id);
      }
    });

    netBoard.append(group);
    netCellGroups.set(cell.id, { group, piece });
  }
}

function buildPieces() {
  pieceGroup.clear();

  for (const cell of topology.cells) {
    const value = state.board[cell.id];
    if (value === EMPTY) {
      continue;
    }

    const normal = vectorForCell(cell);
    const radius = tileSize(cell) * 0.28;
    const material = new THREE.MeshStandardMaterial({
      color: value === BLACK ? colors.blackPiece : colors.whitePiece,
      roughness: value === BLACK ? 0.58 : 0.42,
      metalness: value === BLACK ? 0.08 : 0.02
    });
    const piece = new THREE.Mesh(pieceGeometry, material);

    piece.position.copy(normal).multiplyScalar(1.068);
    piece.quaternion.setFromUnitVectors(unitY, normal);
    piece.scale.set(radius, 0.13, radius);
    piece.userData.cellId = cell.id;
    pieceGroup.add(piece);
  }
}

function vectorForCell(cell) {
  return vectorForNormal(cell.normal);
}

function vectorForNormal(normal) {
  return new THREE.Vector3(normal[0], normal[2], normal[1]).normalize();
}

function tileSize(cell) {
  const latitudeRadius = Math.sqrt(Math.max(0.04, 1 - cell.height * cell.height));
  const eastArc = (Math.PI * 2 * latitudeRadius) / cell.nphi;
  const minSize = topology.nside <= 2 ? 0.17 : 0.025;
  const maxSize = topology.nside <= 2 ? 0.34 : topology.nside <= 4 ? 0.2 : 0.13;
  return THREE.MathUtils.clamp(eastArc * 0.72, minSize, maxSize);
}

function nudgeCameraTowardCell(cellId, holdMs = 1300) {
  const cell = topology.cells[cellId];
  if (!cell) {
    return;
  }

  const normal = vectorForCell(cell);
  const currentDirection = camera.position.clone().sub(controls.target).normalize();
  const distance = camera.position.distanceTo(controls.target);
  const targetDirection = currentDirection.lerp(normal, 0.18).normalize();
  cameraFocusTarget.copy(targetDirection.multiplyScalar(distance).add(controls.target));
  controls.target.set(0, 0, 0);
  hasCameraFocusTarget = true;
  focusHoldUntil = performance.now() + holdMs;
}

function updateLocatorMarker() {
  const cellId = hoveredCellId ?? focusCellId;
  const cell = cellId === null ? null : topology.cells[cellId];

  if (!cell) {
    locatorMarker.visible = false;
    return;
  }

  const normal = vectorForCell(cell);
  const size = tileSize(cell) * 0.62;
  locatorMarker.position.copy(normal).multiplyScalar(1.108);
  locatorMarker.quaternion.setFromUnitVectors(unitZ, normal);
  locatorMarker.scale.set(size, size, 1);
  locatorMarker.visible = true;
}

function baseColorFor(cell) {
  return (cell.ring + cell.column) % 2 === 0 ? colors.baseTile : colors.alternateTile;
}

function refresh() {
  const moves = validMoves(topology, state.board, state.current);
  legalMoves = new Map(moves.map((move) => [move.cellId, move]));

  for (const cell of topology.cells) {
    const mesh = tileMeshes.get(cell.id);
    const material = mesh.material;
    const isLegal = legalMoves.has(cell.id);
    const isLastMove = state.lastMove?.cellId === cell.id;
    const isHintMove = hintMoveId === cell.id && isLegal;
    const isHovered = hoveredCellId === cell.id;
    const isFocused = focusCellId === cell.id;

    if (isHovered) {
      material.color.copy(colors.hover);
      material.emissive = colors.hover.clone().multiplyScalar(0.14);
    } else if (isHintMove) {
      material.color.copy(colors.hint);
      material.emissive = colors.hint.clone().multiplyScalar(0.16);
    } else if (isLegal) {
      material.color.copy(state.current === BLACK ? colors.legalBlack : colors.legalWhite);
      material.emissive = material.color.clone().multiplyScalar(0.08);
    } else if (isLastMove) {
      material.color.copy(colors.last);
      material.emissive = colors.last.clone().multiplyScalar(0.1);
    } else {
      material.color.copy(baseColorFor(cell));
      material.emissive = new THREE.Color(0x000000);
    }

    const netCell = netCellGroups.get(cell.id);
    if (netCell) {
      netCell.group.classList.toggle("legal", isLegal);
      netCell.group.classList.toggle("last", isLastMove);
      netCell.group.classList.toggle("hint", isHintMove);
      netCell.group.classList.toggle("hovered", isHovered);
      netCell.group.classList.toggle("located", isFocused);
      netCell.piece.classList.toggle("black", state.board[cell.id] === BLACK);
      netCell.piece.classList.toggle("white", state.board[cell.id] === WHITE);
    }
  }

  updateLocatorMarker();
  buildPieces();
  updateHud(moves.length);
}

function updateHud(moveTotal) {
  const counts = countPieces(state.board);
  resolutionLabel.textContent = `NSIDE ${topology.nside} / ${pixelCount(topology.nside)} cells`;
  blackScore.textContent = String(counts.black);
  whiteScore.textContent = String(counts.white);

  if (state.gameOver) {
    const winner = counts.black === counts.white ? "引き分け" : counts.black > counts.white ? "黒勝ち" : "白勝ち";
    turnLabel.textContent = "終了";
    turnLabel.style.color = "#f0c84b";
    message.textContent = `${winner} / 黒 ${counts.black} - 白 ${counts.white}`;
  } else {
    const playerLabel = state.current === BLACK ? "黒番" : "白番";
    const npcLabel = isNpcTurn() ? " NPC" : "";
    turnLabel.textContent = `${playerLabel}${npcLabel}`;
    turnLabel.style.color = state.current === BLACK ? "#64c3a5" : "#f0c84b";

    if (state.lastMove?.autoPass) {
      message.textContent = `${state.current === BLACK ? "白" : "黒"}は合法手なし / 合法手 ${moveTotal}`;
    } else if (moveTotal === 0) {
      message.textContent = "合法手なし";
    } else {
      message.textContent = `合法手 ${moveTotal}`;
    }
  }

  passButton.disabled = state.gameOver || moveTotal > 0 || isNpcTurn();
  const canRequestHint = !state.gameOver && !isNpcTurn() && moveTotal > 0;
  godHintButton.disabled = hintBusy || !canRequestHint;
  if (!hintBusy) {
    godHintButton.textContent = hintMoveId !== null && legalMoves.has(hintMoveId) ? "この手を打つ" : "神の一手";
  }
}

function render() {
  if (hasCameraFocusTarget) {
    camera.position.lerp(cameraFocusTarget, 0.07);
    if (camera.position.distanceTo(cameraFocusTarget) < 0.008) {
      camera.position.copy(cameraFocusTarget);
      hasCameraFocusTarget = false;
    }
  }

  const focusHold = hasCameraFocusTarget || performance.now() < focusHoldUntil;
  controls.autoRotate = !pointerDown && hoveredCellId === null && !focusHold && !state.gameOver;
  controls.update();
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
  positionAxisWidget();
}

function positionAxisWidget() {
  if (!axisWidget) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const size = Math.round(THREE.MathUtils.clamp(Math.min(viewportWidth, viewportHeight) * 0.2, 150, 185));
  const left = 18;
  let bottom = 18;

  if (netPanel && viewportWidth <= 840) {
    const netBounds = netPanel.getBoundingClientRect();
    const overlapsLeft = netBounds.left < left + size + 12;
    const overlapsBottom = netBounds.bottom > viewportHeight - bottom - size;
    if (overlapsLeft && overlapsBottom) {
      bottom = Math.round(viewportHeight - netBounds.top + 14);
    }
  }

  bottom = Math.round(THREE.MathUtils.clamp(bottom, 18, Math.max(18, viewportHeight - size - 18)));
  axisWidget.style.width = `${size}px`;
  axisWidget.style.height = `${size}px`;
  axisWidget.style.left = `${left}px`;
  axisWidget.style.bottom = `${bottom}px`;
  updateAxisWidgetDirections();
}

function updateAxisWidgetDirections() {
  const centerX = 78;
  const centerY = 82;
  const arrowRadius = 54;
  const labelRadius = 64;
  axisWidgetRotation.copy(camera.quaternion).invert();

  for (const item of axisWidgetItems) {
    if (!item.line) {
      continue;
    }

    axisWidgetDirection.copy(item.direction).applyQuaternion(axisWidgetRotation);
    const projectedLength = Math.hypot(axisWidgetDirection.x, axisWidgetDirection.y);
    const endX = centerX + axisWidgetDirection.x * arrowRadius;
    const endY = centerY - axisWidgetDirection.y * arrowRadius;

    item.line.setAttribute("x1", centerX);
    item.line.setAttribute("y1", centerY);
    item.line.setAttribute("x2", endX.toFixed(1));
    item.line.setAttribute("y2", endY.toFixed(1));

    if (!item.text) {
      continue;
    }

    let labelX;
    let labelY;
    if (projectedLength < 0.22) {
      labelX = centerX + item.fallback.x;
      labelY = centerY + item.fallback.y;
    } else {
      const unitX = axisWidgetDirection.x / projectedLength;
      const unitY = -axisWidgetDirection.y / projectedLength;
      labelX = centerX + unitX * labelRadius;
      labelY = centerY + unitY * labelRadius;
    }

    labelX = THREE.MathUtils.clamp(labelX, item.halfWidth + 4, 156 - item.halfWidth);
    labelY = THREE.MathUtils.clamp(labelY, 16, 146);
    item.text.setAttribute("x", labelX.toFixed(1));
    item.text.setAttribute("y", labelY.toFixed(1));
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function onPointerDown(event) {
  pointerDown = {
    x: event.clientX,
    y: event.clientY,
    id: event.pointerId
  };
  hasCameraFocusTarget = false;
  focusHoldUntil = 0;
}

function onPointerMove(event) {
  const cellId = pickCell(event);
  if (cellId !== hoveredCellId) {
    hoveredCellId = cellId;
    if (cellId !== null) {
      focusCellId = cellId;
    }
    refresh();
  }
}

function onPointerUp(event) {
  if (!pointerDown || pointerDown.id !== event.pointerId) {
    return;
  }

  const dragDistance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;

  if (dragDistance > 6 || state.gameOver || isNpcTurn()) {
    return;
  }

  const cellId = pickCell(event);
  if (cellId !== null) {
    playCell(cellId);
  }
}

function clearHover() {
  if (hoveredCellId !== null) {
    hoveredCellId = null;
    refresh();
  }
  pointerDown = null;
}

function pickCell(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(tileGroup.children, false);
  if (intersections.length === 0) {
    return null;
  }

  return intersections[0].object.userData.cellId;
}

function playCell(cellId) {
  if (!legalMoves.has(cellId)) {
    if (state.board[cellId] === EMPTY) {
      message.textContent = "そこには置けません";
    }
    return;
  }

  const next = applyMove(topology, state, cellId);
  if (!next) {
    return;
  }

  clearHint();
  focusCellId = cellId;
  state = next;
  hoveredCellId = null;
  refresh();
  requestAiIfNeeded();
}

function isNpcTurn(player = state.current) {
  return npcPlayers.has(player) && !state.gameOver;
}

function requestAiIfNeeded() {
  window.clearTimeout(aiTimer);

  if (!isNpcTurn()) {
    return;
  }

  aiTimer = window.setTimeout(() => {
    if (!isNpcTurn()) {
      return;
    }

    const player = state.current;
    clearHint();
    const move = chooseAiMove(topology, state.board, player, aiDifficulties[player]);
    if (move) {
      focusCellId = move.cellId;
      state = applyMove(topology, state, move.cellId);
      refresh();
      requestAiIfNeeded();
    } else {
      const passed = passTurn(topology, state);
      if (passed) {
        state = passed;
        refresh();
        requestAiIfNeeded();
      }
    }
  }, 430);
}

function toggleNpc(player) {
  if (npcPlayers.has(player)) {
    npcPlayers.delete(player);
  } else {
    npcPlayers.add(player);
  }

  clearHint();
  updatePlayerButtons();
  refresh();
  requestAiIfNeeded();
}

function updatePlayerButtons() {
  const blackIsNpc = npcPlayers.has(BLACK);
  const whiteIsNpc = npcPlayers.has(WHITE);

  blackNpcToggle.setAttribute("aria-pressed", String(blackIsNpc));
  whiteNpcToggle.setAttribute("aria-pressed", String(whiteIsNpc));
  blackNpcToggle.textContent = blackIsNpc ? "黒NPC" : "黒PC";
  whiteNpcToggle.textContent = whiteIsNpc ? "白NPC" : "白PC";
}

function playerForDifficultyButton(button) {
  return button.dataset.player === "black" ? BLACK : WHITE;
}

function updateDifficultyButtons() {
  for (const button of difficultyButtons) {
    const player = playerForDifficultyButton(button);
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === aiDifficulties[player]));
  }
}

function setDifficulty(event) {
  const button = event.currentTarget;
  const player = playerForDifficultyButton(button);
  aiDifficulties[player] = button.dataset.difficulty;
  updateDifficultyButtons();
  requestAiIfNeeded();
}

function requestPass() {
  if (isNpcTurn()) {
    return;
  }

  const passed = passTurn(topology, state);
  if (!passed) {
    return;
  }

  clearHint();
  state = passed;
  refresh();
  requestAiIfNeeded();
}

function resetGame() {
  window.clearTimeout(aiTimer);
  state = createInitialState(topology);
  hoveredCellId = null;
  focusCellId = null;
  hasCameraFocusTarget = false;
  focusHoldUntil = 0;
  clearHint();
  refresh();
  requestAiIfNeeded();
}

function positionKey() {
  return `${topology.nside}:${state.current}:${state.board.join(",")}`;
}

function clearHint() {
  hintMoveId = null;
  hintBusy = false;
  hintToken += 1;
}

function requestGodHint() {
  if (hintBusy || state.gameOver || isNpcTurn()) {
    return;
  }

  if (hintMoveId !== null && legalMoves.has(hintMoveId)) {
    playCell(hintMoveId);
    return;
  }

  const requestKey = positionKey();
  const requestToken = hintToken + 1;
  hintToken = requestToken;
  hintMoveId = null;
  hintBusy = true;
  godHintButton.disabled = true;
  godHintButton.textContent = "計算中";
  message.textContent = "神の一手を計算中";

  window.setTimeout(() => {
    if (hintToken !== requestToken || positionKey() !== requestKey || state.gameOver || isNpcTurn()) {
      clearHint();
      refresh();
      return;
    }

    const move = chooseAiMove(topology, state.board, state.current, "god");
    hintBusy = false;

    if (!move || hintToken !== requestToken || positionKey() !== requestKey) {
      clearHint();
      refresh();
      message.textContent = "神の一手なし";
      return;
    }

    hintMoveId = move.cellId;
    hoveredCellId = null;
    refresh();
    message.textContent = "神の一手を表示";
  }, 30);
}
