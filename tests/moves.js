/* =====================================================================
   Move coverage for any fighter folder:
   node tests/moves.js <folder> [<folder>...]
   Every named command of the fighter is forced once from a neutral
   position (opponent standing 140 px away, full power). A move is reported
   when it never gives control back within 600 ticks, drags the fighter off
   screen, or does nothing at all. Some moves (grabs, supers that need a
   target, helper-only logic) legitimately end the test early; read the
   list as hints.
   ===================================================================== */
const { ROOT, open } = require('./lib');
(async () => {
  const folders = process.argv.slice(2);
  if (!folders.length) {
    console.log('usage: node tests/moves.js <fighter folder>...');
    return;
  }
  const page = await open('file://' + ROOT + '/dist/immortals-kombat.html');
  await page.click('[data-act=versus]');
  for (const folder of folders) {
    await page.setInputFiles('#mg-dir', folder);
    await page.waitForTimeout(6000);
  }
  const results = await page.evaluate(async () => {
    const report = {},
      chars = IK.CHARS.filter(ch => ch.name !== 'Kaelith'),
      dummy = IK.CHARS.find(ch => ch.name === 'Kaelith');
    for (const ch of chars) {
      await IK.Match.begin('practice', ch, dummy, 'random', 0);
      while (IK.G.phase !== 'intro' && IK.G.phase !== 'fight') await new Promise(resolve => setTimeout(resolve, 20));
      const [fighter, opponent] = IK.G.fighters;
      fighter.inputFn = () => ({});
      opponent.inputFn = () => ({});
      const commandNames = [
        ...new Set(
          fighter.pkg.commands
            .map(command => command.name)
            .filter(name => !/^(hold|fwd|back|up|down|recovery|start|taunt$|AI\d)/i.test(name))
        )
      ];
      const problems = [];
      /**
       * Forces one command and watches what the fighter does for up to 600 ticks.
       * @param {string} commandName command to force
       * @param {boolean} inAir start the fighter in the air
       */
      const tryMove = (commandName, inAir) => {
        IK.G.phase = 'fight';
        IK.G.locked = false;
        fighter.changeState(0);
        fighter.life = fighter.maxHp;
        opponent.life = opponent.maxHp;
        fighter.posX = 0;
        fighter.posY = inAir ? -120 : 0;
        fighter.velX = fighter.velY = 0;
        fighter.power = fighter.powerMax;
        fighter.ctrl = true;
        fighter.helpers.length = 0;
        fighter.vars.fill(0);
        fighter.fvars.fill(0);
        fighter.sysvars.fill(0);
        fighter.sysfvars.fill(0);
        fighter.hitdef = null;
        fighter.projs.length = 0;
        fighter.explods.length = 0;
        if (inAir) {
          fighter.type = 'A';
          fighter.physics = 'A';
          fighter.changeState(50);
          fighter.ctrl = true;
        }
        opponent.changeState(0);
        opponent.posX = 140 / opponent.s;
        opponent.posY = 0;
        opponent.velX = opponent.velY = 0;
        const startStateNumber = fighter.stateno;
        fighter.force[commandName.toLowerCase()] = 3;
        let startedAt = -1,
          returnedAt = -1,
          farthestX = 0,
          highestY = 0;
        const statesSeen = [];
        for (let tick = 0; tick < 600; tick++) {
          Sched.step();
          IK.G.update();
          opponent.life = opponent.maxHp;
          if (opponent.stateno >= 5000 || opponent.stateno === 190) {
            opponent.changeState(0);
            opponent.ctrl = false;
          }
          opponent.posX = 140 / opponent.s;
          opponent.velX = 0;
          if (
            startedAt < 0 &&
            fighter.stateno !== startStateNumber &&
            fighter.stateno !== 20 &&
            fighter.stateno !== 51 &&
            fighter.stateno !== 50
          )
            startedAt = tick;
          if (startedAt >= 0 && statesSeen[statesSeen.length - 1] !== fighter.stateno) statesSeen.push(fighter.stateno);
          farthestX = Math.max(farthestX, Math.abs(fighter.posX));
          highestY = Math.min(highestY, fighter.posY);
          if (startedAt >= 0 && fighter.ctrl && fighter.stateno < 200 && tick > startedAt + 2) {
            returnedAt = tick;
            break;
          }
        }
        return { startedAt, returnedAt, farthestX, highestY, statesSeen, now: fighter.stateno };
      };
      for (const commandName of commandNames) {
        let attempt = tryMove(commandName, false);
        if (attempt.startedAt < 0) attempt = tryMove(commandName, true);
        if (attempt.startedAt < 0) problems.push(commandName + ': does nothing');
        else if (attempt.returnedAt < 0)
          problems.push(
            commandName +
              ': never returns (states ' +
              attempt.statesSeen.slice(0, 6).join('>') +
              ', now ' +
              attempt.now +
              ')'
          );
        else if (attempt.farthestX > 700 || attempt.highestY < -700)
          problems.push(
            commandName +
              ': off screen (x ' +
              Math.round(attempt.farthestX) +
              ', y ' +
              Math.round(attempt.highestY) +
              ')'
          );
      }
      report[ch.name] = {
        commands: commandNames.length,
        bad: problems,
        warn: MG.log.filter(line => /Unsupported|Bad expression|Missing state/.test(line)).slice(0, 12)
      };
    }
    return report;
  });
  console.log(JSON.stringify(results, null, 1));
  console.log(page.errs);
  await page.close2();
})();
