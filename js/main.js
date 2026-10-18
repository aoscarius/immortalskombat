/* =====================================================================
   Boot: input routing, menu actions, fixed-step main loop.
   Runs last (after every other script): wires keyboard, pointer, touch and
   menu events to the game objects, drives the 60 Hz simulation from
   requestAnimationFrame, and exposes the window.IK debug/automation hook.
   ===================================================================== */

/**
 * Pauses or resumes the match (never in online play, where the simulation is shared).
 * @param {boolean} shouldPause true to pause, false to resume
 */
function setPause(shouldPause) {
  if (Match.mode === 'online') return; /* no pausing a shared simulation */
  if (shouldPause === G.paused) return;
  if (
    shouldPause &&
    !(G.phase === 'fight' || G.phase === 'intro' || G.phase === 'ko' || G.phase === 'over' || G.phase === 'time')
  )
    return;
  G.paused = shouldPause;
  show(shouldPause ? 'pause' : 'game');
  Snd.ui();
  if (shouldPause) {
    Snd.stopAll();
    // highlight the first entry of the pause menu
    $('#pmenu')
      .querySelectorAll('.btn')
      .forEach((button, index) => button.classList.toggle('sel', index === 0));
  }
}

/**
 * Routes one key press to the handler of the screen that is currently shown.
 * @param {string} code KeyboardEvent.code of the pressed key
 */
function onKey(code) {
  switch (UI.cur) {
    case 'title':
      navMenu(code, $('#menu'));
      break;
    case 'select':
      Sel.key(code);
      break;
    case 'result':
      if (code === 'Escape') toMenu();
      else navMenu(code, $('#res-btns'));
      break;
    case 'help':
      if (code === 'Escape' || code === 'Enter' || code === 'KeyJ' || code === 'Space') closeHelp();
      break;
    case 'net':
      if (code === 'Escape') {
        Net.close();
        toMenu();
      }
      break;
    case 'pause':
      if (code === 'Escape' || code === 'KeyP') setPause(false);
      else navMenu(code, $('#pmenu'));
      break;
    case 'game':
      if (code === 'Escape' || code === 'KeyP') setPause(true);
      else if (code === 'Space') Debug.cheatFill();
      else if (code === 'KeyB') G.showBoxes = !G.showBoxes;
      else if (code === 'KeyT' && Match.mode === 'practice') {
        Match.dummy = DUMMIES[(DUMMIES.indexOf(Match.dummy) + 1) % DUMMIES.length];
        Match.tip();
        Snd.ui();
      }
      break;
  }
}
/**
 * Opens the help screen and remembers which screen to return to.
 * @param {string} fromScreen name of the screen that opened the help ('title' or 'pause')
 */
function openHelp(fromScreen) {
  UI.helpFrom = fromScreen;
  show('help');
}

/** Closes the help screen and goes back to the screen that opened it. */
function closeHelp() {
  show(UI.helpFrom);
}

/** Unlocks audio on the first user gesture and starts the menu music if it is not playing. */
function wake() {
  Snd.init();
  if (!Snd.musicOn && Snd.on && Snd.ctx && !Snd.stageMusic) Snd.music(true);
}
/* keyboard: text fields keep their keys; F2-F4 are debug shortcuts; everything else feeds the game */
addEventListener('keydown', event => {
  const isTyping = event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
  if (isTyping) {
    if (event.code === 'Enter' && event.target.id === 'net-join-code') $('#net-join').click();
    return;
  }
  if (GAMEKEYS.has(event.code) || event.code === 'Space' || event.code === 'Escape' || event.code === 'Enter')
    event.preventDefault();
  if (event.code === 'F2' || event.code === 'F3' || event.code === 'F4') {
    event.preventDefault();
    if (!event.repeat && UI.cur === 'game')
      event.code === 'F2' ? Debug.cheatEnemy() : event.code === 'F3' ? Debug.copy() : Debug.toggle();
    return;
  }
  wake();
  if (event.repeat) return;
  keys.add(event.code);
  onKey(event.code);
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => {
  keys.clear();
  for (const key in virt) virt[key] = 0;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && UI.cur === 'game') setPause(true);
});
addEventListener('pointerdown', wake);

/* menu actions */
$('#menu').addEventListener('click', event => {
  const button = event.target.closest('.btn');
  if (!button) return;
  Snd.init();
  const action = button.dataset.act;
  if (action === 'arcade' || action === 'versus' || action === 'practice' || action === 'roster')
    Sel.open(action === 'roster' ? 'practice' : action);
  else if (action === 'online') {
    show('net');
    Net.status(
      Net.available() ? '' : 'The PeerJS library is not available in this environment, so online play is disabled.',
      !Net.available()
    );
    $('#net-room').hidden = true;
  } else if (action === 'help') openHelp('title');
  else if (action === 'sound') {
    Snd.setOn(!Snd.on);
    button.textContent = 'Sound: ' + (Snd.on ? 'On' : 'Off');
    if (Snd.on) {
      Snd.init();
      Snd.music(true);
      Snd.ok();
    } else {
      Snd.music(false);
      try {
        speechSynthesis.cancel();
      } catch (error) {}
    }
  }
});
$('#pmenu').addEventListener('click', event => {
  const button = event.target.closest('.btn');
  if (!button) return;
  const action = button.dataset.act;
  if (action === 'resume') setPause(false);
  else if (action === 'restart') {
    G.paused = false;
    Match.begin(Match.mode, Match.c[0], Match.c[1], Match.stageRec, Match.lv);
  } else if (action === 'phelp') openHelp('pause');
  else if (action === 'quit') toMenu();
});
$('#sel-back').addEventListener('click', () => {
  if (Match.mode === 'online' || Net.role) Net.close();
  toMenu();
});
$('#sel-stage').addEventListener('click', () => Sel.cycleStage(1));
$('#help-back').addEventListener('click', closeHelp);
$('#net-host').addEventListener('click', () => Net.host());
$('#net-join').addEventListener('click', () => Net.join($('#net-join-code').value));
$('#net-back').addEventListener('click', () => {
  Net.close();
  toMenu();
});
$('#net-copy').addEventListener('click', () => {
  const code = $('#net-code').textContent;
  try {
    navigator.clipboard.writeText(code).then(
      () => Net.status('Code copied.'),
      () => Net.status('Select the code and copy it by hand.')
    );
  } catch (error) {
    Net.status('Select the code and copy it by hand.');
  }
});
bindMenu($('#menu'));
bindMenu($('#pmenu'));

/* importer buttons and drag-drop */
$('#base-load').addEventListener('click', () => Content.setBase($('#base-url').value));
$('#base-url').addEventListener('keydown', event => {
  if (event.code === 'Enter') {
    event.preventDefault();
    Content.setBase(event.target.value);
  }
});
$('#mg-pick-dir').addEventListener('click', () => $('#mg-dir').click());
$('#mg-pick-zip').addEventListener('click', () => $('#mg-zip').click());
$('#mg-dir').addEventListener('change', event => {
  MGUI.fromFiles(event.target.files);
  event.target.value = '';
});
$('#mg-zip').addEventListener('change', event => {
  MGUI.fromFiles(event.target.files);
  event.target.value = '';
});
['dragenter', 'dragover'].forEach(eventName =>
  addEventListener(eventName, event => {
    if (UI.cur !== 'select') return;
    event.preventDefault();
    $('#mg-box').classList.add('drag');
  })
);
['dragleave', 'drop'].forEach(eventName => addEventListener(eventName, () => $('#mg-box').classList.remove('drag')));
addEventListener('drop', event => {
  if (UI.cur !== 'select') return;
  event.preventDefault();
  MGUI.fromDrop(event.dataTransfer);
});

/* touch pad */
document.querySelectorAll('#touch button').forEach(button => {
  const virtualKey = button.dataset.k,
    setPressed = value => {
      virt[virtualKey] = value;
      button.classList.toggle('on', !!value);
    };
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    wake();
    setPressed(1);
    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {}
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(eventName, () => setPressed(0));
});

/* ------------------------------ main loop ------------------------------ */
let lastFrameTime = performance.now(),
  accumulatedMs = 0; // real time not yet consumed by simulation ticks
const STEP = 1000 / 60; // one simulation tick in milliseconds

/**
 * requestAnimationFrame callback: runs as many fixed 60 Hz ticks as the elapsed
 * time allows (at most 3), then renders and updates the HUD and debug overlay.
 * @param {number} now high-resolution timestamp supplied by requestAnimationFrame
 */
function frame(now) {
  accumulatedMs += Math.min(50, now - lastFrameTime);
  lastFrameTime = now;
  for (let tickCount = 0; accumulatedMs >= STEP; tickCount++) {
    if (tickCount >= 3) {
      accumulatedMs = 0;
      break;
    } /* never try to catch up more than 3 ticks in one frame: a slow machine drops time instead of spiralling */
    if (G.paused) {
      accumulatedMs = 0;
      break;
    }
    accumulatedMs -= STEP;
    if (Match.net && Net.active) {
      // lockstep: wait for the remote inputs before simulating
      if (!Net.step()) {
        accumulatedMs = Math.min(accumulatedMs, STEP * 6);
        break;
      }
      Sched.step();
      G.update();
      Net.afterTick();
    } else {
      Sched.step();
      G.update();
    }
  }
  render();
  hudUpdate();
  Debug.update(now);
  requestAnimationFrame(frame);
}
/* debug / automation hook */
window.IK = {
  G,
  Match,
  Sel,
  CHARS,
  STAGES,
  Roster,
  Content,
  Thumbs,
  MG,
  Mugen,
  MGUI,
  Net,
  RNG,
  sample,
  keys,
  toMenu,
  Snd
};
/** Builds the select screen, shows the title menu, starts the loop and loads the content base. */
(async function boot() {
  Sel.build();
  toMenu();
  requestAnimationFrame(frame);
  await Content.boot();
  Sel.build();
  window.IK.ready = true;
})();
