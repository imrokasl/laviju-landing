// Every shader the first frames need, built side by side before they are
// drawn.
//
// A drawing builds each program the moment it first needs it and waits for
// it there, one after another: the house's 73 kept the page frozen behind
// the loader for ten seconds and more on a first visit. So the first frames
// are rehearsed before they are drawn. In the rehearsal every draw only asks
// for its program, through three's own compile, with the target, the camera
// and the lights of that moment, and draws nothing. The driver then builds
// them all at once (KHR_parallel_shader_compile), off the page's thread,
// and the real drawing finds every one of them ready.

// Draws nothing, and asks for every program `draw` would use
export function rehearse(renderer, scene, camera, draw) {
  const direct = renderer.renderBufferDirect;
  // Each scene is compiled for through a stand-in of its own, which three
  // keeps its own lights for, so that the drawing being rehearsed keeps the
  // lights it gathered
  const stands = new Map();
  const stand = (of) => {
    if (!stands.has(of)) stands.set(of, Object.create(of));
    return stands.get(of);
  };
  // The shadow pass draws in no scene at all: no fog, no surroundings, only
  // the lights of the frame
  const bare = Object.assign(Object.create(scene), { fog: null, environment: null, background: null, overrideMaterial: null });
  // A material keeps the program it was last drawn with until something
  // three looks at changes (its version, the kind of mesh, whether it draws
  // to the screen): a shadow material shared by sheets and solids keeps the
  // side of whichever came first, and the rehearsal asks for no more than that
  const last = new WeakMap();
  renderer.renderBufferDirect = (view, drawn, geometry, material, object) => {
    const key = `${material.version} ${!!object.isInstancedMesh} ${!!object.instanceColor} ${!!object.isBatchedMesh} ${!!object.isSkinnedMesh} ${renderer.getRenderTarget() === null}`;
    if (last.get(material) === key) return;
    last.set(material, key);
    // The object as it is, with only the material of this draw (a shadow
    // pass draws with another one) and none of its children
    const one = Object.create(object);
    one.material = material;
    one.children = [];
    // The shadow pass draws without a scene, by the lights of the frame
    // (atmosphere.js keeps them the same for every drawing of it)
    if (drawn === null) renderer.compile(one, camera, bare);
    else renderer.compile(one, view, stand(drawn));
  };
  try {
    draw();
  } finally {
    renderer.renderBufferDirect = direct;
  }
}

// Resolves once every program is built, telling how far along it is; never
// later than `patience` seconds, after which a drawing waits for the rest itself
export function compiled(renderer, onProgress = () => {}, patience = 30) {
  const programs = renderer.info.programs ?? [];
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const ready = programs.filter((program) => program.isReady()).length;
      onProgress(programs.length ? ready / programs.length : 1);
      if (ready === programs.length || performance.now() - started > patience * 1000) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}
