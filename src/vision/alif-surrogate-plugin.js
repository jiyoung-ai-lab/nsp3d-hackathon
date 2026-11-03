// NSP 3D — alif-surrogate-plugin.js (detachable extension)
// ALIF adaptive threshold + Fast-Sigmoid surrogate-gradient eligibility
// + collision-index / epsilon-greedy balancer.
// Reference-compatible interface: integrateNeurons / updateReadoutEligibility /
// reinforce over the anatomical core. Legacy 4-neuron API kept for fallback.
// Loose coupling: removing this file falls back to baseline LIF without errors.
export const ALIFSurrogatePlugin = {
  name: 'alif-surrogate',
  version: '1.1',
  defaults: {
    theta0: 0.6,
    alphaV: 0.9,
    alphaA: 0.95,
    betaAdapt: 0.08,
    gammaA: 0.5,
    betaSg: 8.0,
    lambdaE: 0.92,
  },

  // Fast-Sigmoid surrogate derivative
  psi(v, theta, betaSg = 8.0) {
    const t = 1 + betaSg * Math.abs(v - theta);
    return 1 / (t * t);
  },

  // ---- anatomical core integration (reference interface) ----
  integrateNeurons(nodes, synapses, state, config, input) {
    const d = ALIFSurrogatePlugin.defaults;
    for (const id of state.lastSpikes) {
      const source = nodes.get(id);
      if (source) for (const syn of source.outgoing) {
        const target = nodes.get(syn.target);
        if (target) target.current += syn.weight;
      }
    }
    const currentSpikes = [];
    let gradSum = 0, gradN = 0;
    for (const n of nodes.values()) {
      if (n.refractory > 0) {
        n.refractory--;
        n.spiking = false;
        // v holds its post-reset value; adapt keeps decaying through refractory.
        n.adapt = Math.max(0, Math.min(3, d.alphaA * (n.adapt || 0)));
      }
      else {
        // Immediate reset at spike time (engine-1 style): threshold sees the
        // OLD adapt, then reset/adapt-bump apply causally (Bellec A(t+1)).
        const th = d.theta0 + d.gammaA * (n.adapt || 0);
        const nvRaw = d.alphaV * n.v + (1 - d.alphaV) * (n.input + n.current);
        const z = nvRaw >= th ? 1 : 0;
        const na = d.alphaA * (n.adapt || 0) + (z ? d.betaAdapt : 0);
        n.v = Math.max(-0.5, Math.min(2.5, z ? nvRaw - d.theta0 : nvRaw));
        n.adapt = Math.max(0, Math.min(3, na));
        n.threshold = th;
        n.spiking = !!z;
        if (z) { n.spikes++; n.refractory = 1; currentSpikes.push(Number(n.id)); }
      }
      const psi = ALIFSurrogatePlugin.psi(n.v, n.threshold, d.betaSg);
      n.surrogateGrad = psi;
      gradSum += psi;
      gradN++;
      n.firingRate = n.firingRate * 0.82 + (n.spiking ? 0.32 : 0);
    }
    state.lastSpikes = currentSpikes;
    state.meanSurrogateGrad = gradN ? gradSum / gradN : 0;
    for (const syn of synapses) {
      const source = nodes.get(syn.source), target = nodes.get(syn.target);
      syn.eligibility *= d.lambdaE;
      if (source && source.spiking) {
        syn.eligibility = Math.min(2, syn.eligibility + (source.surrogateGrad || 0) * (0.12 + (target ? target.firingRate : 0) * 0.35));
      }
    }
    return currentSpikes;
  },

  updateReadoutEligibility(state, core, turnSign, turnActivity, verticalSign, verticalActivity, turn, input) {
    const P = ALIFSurrogatePlugin;
    const boost = 1 + (state.meanSurrogateGrad || 0);
    state.eligibility.left = Math.min(1, state.eligibility.left * 0.94 + (turnSign > 0 ? turnActivity : 0) * 0.08 * boost);
    state.eligibility.right = Math.min(1, state.eligibility.right * 0.94 + (turnSign < 0 ? turnActivity : 0) * 0.08 * boost);
    state.eligibility.climb = Math.min(1, state.eligibility.climb * 0.94 + (verticalSign > 0 ? verticalActivity : 0) * 0.08 * boost);
    state.eligibility.dive = Math.min(1, state.eligibility.dive * 0.94 + (verticalSign < 0 ? verticalActivity : 0) * 0.08 * boost);
    const prox = input && input.proxThreat != null ? input.proxThreat : Math.max(input.leftThreat || 0, input.rightThreat || 0, input.frontThreat || 0);
    state.collisionIndex = P.updateCidx(state.collisionIndex || 0, !!(input && input.collided), prox);
    state.explorationRate = P.epsilon(state.collisionIndex, state.rewardEma || 0, 0.04);
    return turn;
  },

  reinforce(state, config, reward, teacher, student) {
    const r = Math.max(-2.5, Math.min(1.5, Number(reward) || 0));
    const coach = { left: 0, right: 0, climb: 0, dive: 0 };
    const isCollisionPenalty = r < -0.35;
    if (teacher && student) {
      const tTurn = Number(teacher.turn) || 0, sTurn = Number(student.rawTurn ?? student.turn) || 0;
      const tClimb = Number(teacher.climb) || 0, sClimb = Number(student.rawClimb ?? student.climb) || 0;
      if (tTurn > 0.004) coach.left = Math.max(-0.25, Math.min(0.85, (tTurn - sTurn) / 0.16 + (isCollisionPenalty ? 0.28 : 0)));
      if (tTurn < -0.004) coach.right = Math.max(-0.25, Math.min(0.85, (-tTurn + sTurn) / 0.16 + (isCollisionPenalty ? 0.28 : 0)));
      if (tClimb > 0.05) coach.climb = Math.max(-0.25, Math.min(0.85, (tClimb - sClimb) / 0.85));
      if (tClimb < -0.05) coach.dive = Math.max(-0.25, Math.min(0.85, (-tClimb + sClimb) / 0.85));
    }
    state.collisionIndex = Math.max(0, Math.min(1, (state.collisionIndex || 0) * 0.9 + (isCollisionPenalty ? 0.35 : 0)));
    state.rewardEma = Math.max(-1, Math.min(1, (state.rewardEma || 0) * 0.92 + r * 0.08));
    state.explorationRate = ALIFSurrogatePlugin.epsilon(state.collisionIndex, state.rewardEma, 0.04);
    if (Math.abs(r) < 1e-5 && !teacher) return { updated: 0, reward: r };
    let updated = 0;
    const lr = state.learnRate != null ? state.learnRate : config.learningRate;
    for (const key of Object.keys(state.gains)) {
      const elig = state.eligibility[key] * (1 + (state.meanSurrogateGrad || 0) * 0.5);
      const penaltyBoost = isCollisionPenalty ? 1.65 : 1.0;
      const signal = teacher
        ? (r < -0.1 ? coach[key] * (0.38 + elig) * 0.52 * penaltyBoost : (r > 0.5 ? r * elig * 0.25 : (1 - state.gains[key]) * 0.05))
        : r * elig;
      if (elig < config.eligibilityThreshold && Math.abs(coach[key]) < 0.02) continue;
      // Teacher coaching anchors gains at/above unity but must not destroy pretrained
      // gains above it: the ceiling follows config.maxGain like the free range.
      const floorGain = teacher ? 1.0 : config.minGain;
      const ceilGain = config.maxGain;
      const next = Math.max(floorGain, Math.min(ceilGain, state.gains[key] + lr * signal));
      if (Math.abs(next - state.gains[key]) > 1e-8) { state.gains[key] = next; updated++; }
      state.eligibility[key] *= 0.65;
    }
    state.rewardUpdates++;
    state.cumulativeReward += r;
    return { updated, reward: r };
  },

  // ---- collision index + epsilon ----
  updateCidx(cidx, collided, proximity) {
    const inst = collided ? 1 : 0.5 * Math.max(0, Math.min(1, proximity));
    return Math.max(0, Math.min(1, 0.94 * cidx + 0.06 * inst + (collided ? 0.2 : 0)));
  },

  epsilon(cidx, rBar, epsMin = 0.04) {
    const e = epsMin + 0.35 * cidx + 0.25 * Math.max(0, -(rBar || 0));
    return Math.max(0.04, Math.min(0.65, e));
  },

  // ---- legacy 4-neuron API (functional fallback core) ----
  adaptiveThreshold(core, k, p) {
    const d = { ...ALIFSurrogatePlugin.defaults, ...(p || {}) };
    return d.theta0 + d.gammaA * core.a[k];
  },

  stepNeurons(core, I, dt, p) {
    const d = { ...ALIFSurrogatePlugin.defaults, ...(p || {}) };
    const steps = Math.max(1, Math.round(dt / (1 / 60)));
    const y = [0, 0, 0, 0];
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < 4; k++) {
        const zPrev = core.z[k] ? 1 : 0;
        const nv = d.alphaV * core.v[k] + (1 - d.alphaV) * I[k] - zPrev * d.theta0;
        const na = d.alphaA * core.a[k] + d.betaAdapt * zPrev;
        const th = d.theta0 + d.gammaA * na;
        const z = nv >= th ? 1 : 0;
        core.v[k] = Math.max(-0.5, Math.min(2.5, nv));
        core.a[k] = Math.max(0, Math.min(3, na));
        core.z[k] = z;
        if (z) y[k] = 1;
      }
    }
    return y;
  },

  updateEligibility(e, xPre, psiV, yPost, lambdaE = 0.92) {
    return lambdaE * e + xPre * psiV * yPost;
  },
};

globalThis.ALIFSurrogatePlugin = ALIFSurrogatePlugin;
export default ALIFSurrogatePlugin;
