type ShadowMapState = {
  autoUpdate: boolean;
  needsUpdate: boolean;
};

export type SplitShadowCache = {
  readonly frozen: boolean;
  begin(splitActive: boolean): void;
  end(): void;
  update(splitActive: boolean, controlsChanged: boolean): void;
  dispose(): void;
};

export function createSplitShadowCache(shadowMap: ShadowMapState): SplitShadowCache {
  let interacting = false;
  let frozen = false;

  const restore = () => {
    if (!frozen) return;
    shadowMap.autoUpdate = true;
    shadowMap.needsUpdate = true;
    frozen = false;
  };

  return {
    get frozen() {
      return frozen;
    },
    begin(splitActive) {
      interacting = splitActive;
      if (!splitActive) {
        restore();
        return;
      }
      if (!frozen) {
        shadowMap.autoUpdate = false;
        frozen = true;
      }
    },
    end() {
      interacting = false;
    },
    update(splitActive, controlsChanged) {
      if (!splitActive || (frozen && !interacting && !controlsChanged)) restore();
    },
    dispose() {
      interacting = false;
      restore();
    },
  };
}
