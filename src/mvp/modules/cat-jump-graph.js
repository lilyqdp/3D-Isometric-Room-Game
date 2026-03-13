export function buildWeightedJumpGraph(THREE, floorY, surfaceRegistry, jumpLinks) {
  const nodes = new Map();
  const edges = new Map();
  const floorAnchors = [];

  const ensureEdges = (id) => {
    if (!edges.has(id)) edges.set(id, []);
    return edges.get(id);
  };
  const addNode = (id, point, surfaceId, kind = "anchor") => {
    nodes.set(id, { id, point: point.clone(), surfaceId, kind });
    ensureEdges(id);
  };
  const addEdge = (from, to, cost, kind = "walk") => {
    ensureEdges(from).push({ to, cost: Math.max(0.001, cost), kind });
  };

  for (const surface of surfaceRegistry.surfaces) {
    const anchors = surface.anchors;
    for (const anchor of anchors) {
      addNode(anchor.nodeId, new THREE.Vector3(anchor.inner.x, surface.y, anchor.inner.z), surface.id, "anchor");
      if (surface.id === "floor") floorAnchors.push(anchor);
    }
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const d = a.inner.distanceTo(b.inner);
      addEdge(a.nodeId, b.nodeId, d, "walk");
      addEdge(b.nodeId, a.nodeId, d, "walk");
    }
  }

  for (const link of jumpLinks) {
    const latchId = `node:latch:${link.id}`;
    link.fromNodeId = latchId;
    link.toNodeId = link.anchorNodeId;
    addNode(latchId, new THREE.Vector3(link.jumpFrom.x, floorY, link.jumpFrom.z), link.fromSurfaceId, "latch");

    let nearest = [];
    for (const anchor of floorAnchors) {
      const d2 = anchor.inner.distanceToSquared(link.jumpFrom);
      nearest.push({ nodeId: anchor.nodeId, d2 });
    }
    nearest.sort((a, b) => a.d2 - b.d2);
    nearest = nearest.slice(0, Math.min(2, nearest.length));
    for (const n of nearest) {
      const d = Math.sqrt(n.d2);
      addEdge(latchId, n.nodeId, d, "walk");
      addEdge(n.nodeId, latchId, d, "walk");
    }

    if (link.staticValidUp !== false) {
      addEdge(latchId, link.toNodeId, link.jumpCost, "jumpUp");
    }
    if (link.staticValidDown !== false) {
      addEdge(link.toNodeId, latchId, link.jumpCost * 0.88, "jumpDown");
    }
  }

  return { nodes, edges };
}

export function dijkstraAllCostsFrom(startId, graph) {
  const dist = new Map();
  const visited = new Set();
  const queue = [{ id: startId, cost: 0 }];
  dist.set(startId, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    if (!cur || visited.has(cur.id)) continue;
    visited.add(cur.id);

    const out = graph.edges.get(cur.id);
    if (!out) continue;
    for (const edge of out) {
      const next = cur.cost + edge.cost;
      const old = dist.get(edge.to);
      if (old == null || next < old) {
        dist.set(edge.to, next);
        queue.push({ id: edge.to, cost: next });
      }
    }
  }
  return dist;
}

export function dijkstraJumpCountsFrom(startId, graph) {
  const dist = new Map();
  const queue = [{ id: startId, jumps: 0 }];
  dist.set(startId, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.jumps - b.jumps);
    const cur = queue.shift();
    if (!cur) continue;
    const bestKnown = dist.get(cur.id);
    if (!Number.isFinite(bestKnown) || cur.jumps > bestKnown) continue;

    const out = graph.edges.get(cur.id);
    if (!out) continue;
    for (const edge of out) {
      const edgeJumpCost = edge.kind === "walk" ? 0 : 1;
      const next = cur.jumps + edgeJumpCost;
      const old = dist.get(edge.to);
      if (old == null || next < old) {
        dist.set(edge.to, next);
        queue.push({ id: edge.to, jumps: next });
      }
    }
  }
  return dist;
}
