import assert from "node:assert/strict";
import {
  BLACK,
  WHITE,
  applyMove,
  chooseAiMove,
  countPieces,
  createInitialState,
  flipsForMove,
  passTurn,
  validMoves
} from "./game.js";
import { HEALPIX_BOUNDARY_SEGMENTS_NSIDE2 } from "./healpix-boundaries-nside2.js";
import { createHealpixTopology, pixelCount } from "./healpix.js";

function bruteValidMoves(topology, board, player) {
  const moves = [];

  for (const cell of topology.cells) {
    const flips = flipsForMove(topology, board, cell.id, player);
    if (flips.length > 0) {
      moves.push({ cellId: cell.id, flips });
    }
  }

  return moves;
}

function moveIds(moves) {
  return moves.map((move) => move.cellId);
}

const topology = createHealpixTopology(2);
assert.equal(topology.cells.length, pixelCount(2));
assert.equal(
  HEALPIX_BOUNDARY_SEGMENTS_NSIDE2.length,
  2 * pixelCount(2) * 16 * 6,
  "HEALPix NSIDE=2 boundary data should contain 1536 XYZ line segments"
);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12);
closeTo(topology.cells[1].normal[0], 0.2852353895437616);
closeTo(topology.cells[1].normal[1], 2 / 3);
closeTo(topology.cells[1].normal[2], 0.6886191459053213);
assert.deepEqual(
  topology.directions.map((direction) => topology.neighbor(0, direction)),
  [17, 19, 2, 3, 1, 23, 22, 35],
  "HEALPix NESTED direction order should be SW, W, NW, N, NE, E, SE, S"
);
assert.deepEqual(
  topology.directions.map((direction) => topology.neighbor(5, direction) ?? -1),
  [4, 6, 7, 11, 10, -1, 27, 26],
  "NESTED face-corner transitions should preserve missing neighbours"
);
assert.deepEqual(
  topology.directions.map((direction) => topology.neighbor(47, direction) ?? -1),
  [46, 28, 29, 12, 18, 16, 45, 44],
  "NESTED south-cap transitions should wrap across base faces"
);

const initial = createInitialState(topology);
assert.deepEqual(countPieces(initial.board), { black: 2, white: 2, empty: 44 });

const blackMoves = validMoves(topology, initial.board, BLACK);
const whiteMoves = validMoves(topology, initial.board, WHITE);
assert.equal(blackMoves.length, 4, "black should have four opening moves");
assert.equal(whiteMoves.length, 4, "white should have four opening moves");

const afterBlack = applyMove(topology, initial, blackMoves[0].cellId);
assert.ok(afterBlack, "a legal black move should apply");
assert.equal(afterBlack.board[blackMoves[0].cellId], BLACK);

const counts = countPieces(afterBlack.board);
assert.equal(counts.black + counts.white + counts.empty, topology.cells.length);
assert.equal(counts.black + counts.white, 5);

function playNpcGame(topology, initialState, difficulty) {
  let sampleState = initialState;
  for (let turn = 0; turn < topology.cells.length + 20 && !sampleState.gameOver; turn += 1) {
    const sampleMoves = validMoves(topology, sampleState.board, sampleState.current);
    if (sampleMoves.length === 0) {
      const passed = passTurn(topology, sampleState);
      if (!passed) {
        break;
      }
      sampleState = passed;
      continue;
    }

    const move = chooseAiMove(topology, sampleState.board, sampleState.current, difficulty);
    sampleState = applyMove(topology, sampleState, move.cellId);
  }

  return sampleState;
}

for (const nside of [2]) {
  const variableTopology = createHealpixTopology(nside);
  const variableInitial = createInitialState(variableTopology);
  const variableBlackMoves = validMoves(variableTopology, variableInitial.board, BLACK);
  const variableWhiteMoves = validMoves(variableTopology, variableInitial.board, WHITE);

  assert.equal(variableTopology.cells.length, pixelCount(nside));
  assert.deepEqual(countPieces(variableInitial.board), {
    black: 2,
    white: 2,
    empty: pixelCount(nside) - 4
  });
  assert.equal(variableBlackMoves.length, 4, `black should have four opening moves at NSIDE ${nside}`);
  assert.equal(variableWhiteMoves.length, 4, `white should have four opening moves at NSIDE ${nside}`);
  assert.deepEqual(moveIds(variableBlackMoves), moveIds(bruteValidMoves(variableTopology, variableInitial.board, BLACK)));

  for (const difficulty of ["easy", "normal", "hard", "expert", "god"]) {
    const npcMove = chooseAiMove(variableTopology, variableInitial.board, BLACK, difficulty);
    assert.ok(
      variableBlackMoves.some((move) => move.cellId === npcMove.cellId),
      `${difficulty} NPC should choose a legal NSIDE ${nside} opening`
    );
  }

  const expertMoveA = chooseAiMove(variableTopology, variableInitial.board, BLACK, "expert");
  const expertMoveB = chooseAiMove(variableTopology, variableInitial.board, BLACK, "expert");
  assert.equal(expertMoveA.cellId, expertMoveB.cellId, `expert NPC should be deterministic at NSIDE ${nside}`);

  const godMoveA = chooseAiMove(variableTopology, variableInitial.board, BLACK, "god");
  const godMoveB = chooseAiMove(variableTopology, variableInitial.board, BLACK, "god");
  assert.equal(godMoveA.cellId, godMoveB.cellId, `god NPC should be deterministic at NSIDE ${nside}`);

  let sampleState = variableInitial;
  for (let turn = 0; turn < 8 && !sampleState.gameOver; turn += 1) {
    const sampleMoves = validMoves(variableTopology, sampleState.board, sampleState.current);
    assert.deepEqual(
      moveIds(sampleMoves),
      moveIds(bruteValidMoves(variableTopology, sampleState.board, sampleState.current)),
      `candidate legal moves should match brute-force moves at NSIDE ${nside}`
    );
    if (sampleMoves.length === 0) {
      break;
    }
    sampleState = applyMove(variableTopology, sampleState, sampleMoves[Math.floor(sampleMoves.length / 2)].cellId);
  }
}

const godGame = playNpcGame(topology, initial, "god");
assert.deepEqual(countPieces(godGame.board), {
  black: 24,
  white: 24,
  empty: 0
});

console.log(`logic ok: ${topology.cells.length} HEALPix cells, ${blackMoves.length} black openings`);
