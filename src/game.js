import {
  BLACK,
  EMPTY,
  WHITE,
  createHealpixTopology
} from "./healpix.js";

export { BLACK, EMPTY, WHITE };

export function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

export function createInitialState(topology = createHealpixTopology()) {
  const board = new Array(topology.cells.length).fill(EMPTY);
  const faceCell = (face, ix, iy) =>
    topology.cells.find((cell) => cell.face === face && cell.ix === ix && cell.iy === iy).id;
  const start = Math.max(0, Math.floor(topology.nside / 2) - 1);
  const topLeft = faceCell(5, start, start);
  const topRight = faceCell(5, start + 1, start);
  const bottomLeft = faceCell(5, start, start + 1);
  const bottomRight = faceCell(5, start + 1, start + 1);

  board[topLeft] = BLACK;
  board[topRight] = WHITE;
  board[bottomLeft] = WHITE;
  board[bottomRight] = BLACK;

  return {
    board,
    current: BLACK,
    moveCount: 0,
    gameOver: false,
    lastMove: null
  };
}

export function countPieces(board) {
  return board.reduce(
    (counts, value) => {
      if (value === BLACK) {
        counts.black += 1;
      } else if (value === WHITE) {
        counts.white += 1;
      }

      return counts;
    },
    { black: 0, white: 0, empty: board.filter((value) => value === EMPTY).length }
  );
}

export function flipsForMove(topology, board, cellId, player) {
  if (board[cellId] !== EMPTY) {
    return [];
  }

  const rival = opponent(player);
  const flips = new Set();

  for (const direction of topology.directions) {
    const path = [];
    const visited = new Set([cellId]);
    let cursor = topology.neighbor(cellId, direction);

    while (cursor !== null && !visited.has(cursor)) {
      visited.add(cursor);

      if (board[cursor] === rival) {
        path.push(cursor);
        cursor = topology.neighbor(cursor, direction);
        continue;
      }

      if (board[cursor] === player && path.length > 0) {
        for (const id of path) {
          flips.add(id);
        }
      }

      break;
    }
  }

  return [...flips];
}

export function validMoves(topology, board, player) {
  const moves = [];
  const rival = opponent(player);
  const candidateIds = new Set();

  for (const cell of topology.cells) {
    if (board[cell.id] !== rival) {
      continue;
    }

    for (const direction of topology.directions) {
      const candidateId = topology.neighbor(cell.id, direction);
      if (candidateId !== null && board[candidateId] === EMPTY) {
        candidateIds.add(candidateId);
      }
    }
  }

  for (const cellId of [...candidateIds].sort((a, b) => a - b)) {
    const flips = flipsForMove(topology, board, cellId, player);
    if (flips.length > 0) {
      moves.push({ cellId, flips });
    }
  }

  return moves;
}

export function applyMove(topology, state, cellId) {
  const player = state.current;
  const flips = flipsForMove(topology, state.board, cellId, player);

  if (flips.length === 0) {
    return null;
  }

  const board = state.board.slice();
  board[cellId] = player;
  for (const id of flips) {
    board[id] = player;
  }

  const nextPlayer = opponent(player);
  const nextMoves = validMoves(topology, board, nextPlayer);
  const returnMoves = validMoves(topology, board, player);
  const gameOver = nextMoves.length === 0 && returnMoves.length === 0;
  const autoPass = !gameOver && nextMoves.length === 0;

  return {
    board,
    current: autoPass ? player : nextPlayer,
    moveCount: state.moveCount + 1,
    gameOver,
    lastMove: {
      player,
      cellId,
      flipped: flips,
      autoPass
    }
  };
}

export function passTurn(topology, state) {
  if (state.gameOver || validMoves(topology, state.board, state.current).length > 0) {
    return null;
  }

  const nextPlayer = opponent(state.current);
  const gameOver = validMoves(topology, state.board, nextPlayer).length === 0;

  return {
    ...state,
    current: nextPlayer,
    gameOver,
    lastMove: {
      player: state.current,
      cellId: null,
      flipped: [],
      autoPass: false,
      manualPass: true
    }
  };
}

function trialBoardForMove(board, move, player) {
  const trialBoard = board.slice();
  trialBoard[move.cellId] = player;
  for (const id of move.flips) {
    trialBoard[id] = player;
  }
  return trialBoard;
}

function positionalValue(cell) {
  return Math.abs(cell.height) * 1.6 + (cell.nphi < 16 ? 0.45 : 0);
}

function createSearchContext(options = {}) {
  return {
    boardKeys: new WeakMap(),
    evaluations: new Map(),
    moves: new Map(),
    maxBranch: options.maxBranch ?? Infinity
  };
}

function boardKeyFor(context, board) {
  let key = context.boardKeys.get(board);
  if (key) {
    return key;
  }

  key = board.map((value) => String(value + 1)).join("");
  context.boardKeys.set(board, key);
  return key;
}

function cachedValidMoves(context, topology, board, player) {
  if (!context) {
    return validMoves(topology, board, player);
  }

  const key = `${player}:${boardKeyFor(context, board)}`;
  let moves = context.moves.get(key);
  if (!moves) {
    moves = validMoves(topology, board, player);
    context.moves.set(key, moves);
  }

  return moves;
}

function immediateMoveScore(topology, board, move, player, context = null) {
  const trialBoard = trialBoardForMove(board, move, player);
  const rivalMobility = cachedValidMoves(context, topology, trialBoard, opponent(player)).length;

  return move.flips.length * 10 + positionalValue(topology.cells[move.cellId]) - rivalMobility * 0.28;
}

function evaluateBoard(topology, board, player, context) {
  const cacheKey = `${player}:${boardKeyFor(context, board)}`;
  const cached = context.evaluations.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const rival = opponent(player);
  let ownPieces = 0;
  let rivalPieces = 0;
  let positionScore = 0;

  for (const cell of topology.cells) {
    const value = board[cell.id];
    if (value === player) {
      ownPieces += 1;
      positionScore += positionalValue(cell);
    } else if (value === rival) {
      rivalPieces += 1;
      positionScore -= positionalValue(cell);
    }
  }

  const ownMoves = cachedValidMoves(context, topology, board, player).length;
  const rivalMoves = cachedValidMoves(context, topology, board, rival).length;
  const pieceDiff = ownPieces - rivalPieces;
  let score;

  if (ownMoves === 0 && rivalMoves === 0) {
    score = pieceDiff * 100000;
  } else {
    const emptyRatio = (board.length - ownPieces - rivalPieces) / board.length;
    const pieceWeight = emptyRatio > 0.55 ? 0.25 : emptyRatio > 0.18 ? 1.4 : 7;

    score = pieceDiff * pieceWeight + (ownMoves - rivalMoves) * 5.4 + positionScore * 1.15;
  }

  context.evaluations.set(cacheKey, score);
  return score;
}

function orderedMovesForSearch(topology, board, moves, currentPlayer, maximizingPlayer, context = null) {
  return moves
    .map((move) => ({
      ...move,
      searchScore: immediateMoveScore(topology, board, move, currentPlayer, context)
    }))
    .sort((a, b) => b.searchScore - a.searchScore || a.cellId - b.cellId);
}

function minimax(topology, board, currentPlayer, maximizingPlayer, depth, alpha, beta, context) {
  if (depth === 0) {
    return evaluateBoard(topology, board, maximizingPlayer, context);
  }

  const moves = cachedValidMoves(context, topology, board, currentPlayer);
  if (moves.length === 0) {
    const nextPlayer = opponent(currentPlayer);
    if (cachedValidMoves(context, topology, board, nextPlayer).length === 0) {
      return evaluateBoard(topology, board, maximizingPlayer, context);
    }

    return minimax(topology, board, nextPlayer, maximizingPlayer, depth - 1, alpha, beta, context);
  }

  const orderedMoves = orderedMovesForSearch(topology, board, moves, currentPlayer, maximizingPlayer, context);
  const searchMoves = Number.isFinite(context.maxBranch) ? orderedMoves.slice(0, context.maxBranch) : orderedMoves;
  const isMaximizing = currentPlayer === maximizingPlayer;
  let best = isMaximizing ? -Infinity : Infinity;

  for (const move of searchMoves) {
    const trialBoard = trialBoardForMove(board, move, currentPlayer);
    const score = minimax(
      topology,
      trialBoard,
      opponent(currentPlayer),
      maximizingPlayer,
      depth - 1,
      alpha,
      beta,
      context
    );

    if (isMaximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }

    if (beta <= alpha) {
      break;
    }
  }

  return best;
}

function chooseLookaheadMove(topology, board, player, responseDepth, options = {}) {
  const moves = validMoves(topology, board, player);
  const context = createSearchContext(options);
  let bestMove = null;
  let bestScore = -Infinity;

  for (const move of orderedMovesForSearch(topology, board, moves, player, player, context)) {
    const trialBoard = trialBoardForMove(board, move, player);
    const score =
      minimax(topology, trialBoard, opponent(player), player, responseDepth, -Infinity, Infinity, context) +
      move.searchScore * 0.001;

    if (score > bestScore || (score === bestScore && (!bestMove || move.cellId < bestMove.cellId))) {
      bestScore = score;
      bestMove = { ...move, score };
    }
  }

  return bestMove;
}

function scoreAiMove(topology, board, move, player, difficulty) {
  const trialBoard = trialBoardForMove(board, move, player);
  const rivalMobility = validMoves(topology, trialBoard, opponent(player)).length;
  const cell = topology.cells[move.cellId];
  const placement = positionalValue(cell);

  if (difficulty === "easy") {
    return -move.flips.length * 9 + rivalMobility * 1.4 - placement * 1.8 + Math.random() * 5;
  }

  if (difficulty === "normal") {
    return move.flips.length * 4 + placement * 0.5 - rivalMobility * 0.12 + Math.random() * 0.8;
  }

  if (difficulty === "hard") {
    return move.flips.length * 6 + placement * 0.7 - rivalMobility * 0.14 + Math.random() * 1.1;
  }

  return immediateMoveScore(topology, board, move, player);
}

function chooseRankedMove(scored, difficulty) {
  if (difficulty === "easy") {
    const poolSize = Math.max(1, Math.ceil(scored.length * 0.45));
    return scored[Math.floor(Math.random() * poolSize)];
  }

  if (difficulty === "hard") {
    const roll = Math.random();
    if (roll < 0.12 && scored[2]) {
      return scored[2];
    }
    if (roll < 0.34 && scored[1]) {
      return scored[1];
    }
  }

  return scored[0];
}

export function chooseAiMove(topology, board, player, difficulty = "easy") {
  const moves = validMoves(topology, board, player);

  if (moves.length === 0) {
    return null;
  }

  if (difficulty === "expert") {
    return chooseLookaheadMove(topology, board, player, 1);
  }

  if (difficulty === "god") {
    return chooseLookaheadMove(topology, board, player, 3, {
      maxBranch: topology.nside <= 2 ? 8 : 7
    });
  }

  const scored = moves.map((move) => {
    const score = scoreAiMove(topology, board, move, player, difficulty);

    return { ...move, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.cellId - b.cellId;
  });

  return chooseRankedMove(scored, difficulty);
}
