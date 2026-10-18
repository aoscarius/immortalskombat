/* =====================================================================
   Engine regression tests: behaviours found with real third-party
   fighters (parser attachment rules, expression compiler, redirections).
   No external content needed.
   ===================================================================== */
const { ROOT, open, pass } = require('./lib');
(async () => {
  const page = await open('file://' + ROOT + '/dist/immortals-kombat.html');
  const result = await page.evaluate(() => {
    const findings = {};
    /* 1. [State n, label]: n is only a label; the controller belongs to the last Statedef */
    const parsedStates = MG.parseCns(
      '[Statedef 963]\ntype=A\n[state 0,0]\ntype=changeanim\ntrigger1=1\nvalue=5000\n[Statedef 40]\n[State -2]\ntype=null\ntrigger1=1\n'
    ).states;
    findings.attach =
      parsedStates.get(963).ctrls.length === 1 && parsedStates.get(40).ctrls.length === 1 && !parsedStates.get(0);
    /* 2. expressions that real content uses */
    const expressions = [
      'AnimElem = 1 > 0',
      'AnimElem = 2, >= 3',
      '1||var(40):=var(40)+1',
      '(EnemyNear(0),Alive)&&(EnemyNear(1),Alive)',
      'facing*(Enemy(0),Pos X - Pos X)>0',
      'ifelse(Time=[0,3],1,2)',
      'PlayerID(var(55)),StateNo=[5119,5139]',
      'PlayerID(var(55)),AnimTime > -6 - (Random%20)*(fvar(8)<120)',
      'Target(13641),StateNo != [120,155]',
      'Helper(1014),Time=0',
      'NumHelper(1014)=0',
      'Root,Var(15)&512',
      'Parent,Vel Y>0'
    ];
    findings.bad = expressions.filter(expression => {
      const logLengthBefore = MG.log.length;
      MG.compile(expression);
      return MG.log.length > logLengthBefore;
    });
    /* 3. AnimElem without a comma means "ticks since element n began, compared to t" */
    const fakeFighter = { animElemTime: elementNumber => 5, vars: [], fvars: [], sysvars: [], sysfvars: [] };
    findings.animelem = [
      MG.compileList('AnimElem = 1 > 0')[0].f(fakeFighter),
      MG.compileList('AnimElem = 1 < 0')[0].f(fakeFighter)
    ];
    /* 4. an indexed redirection other than 0 does not exist in 1v1 */
    findings.split =
      MG.splitArgs('PlayerID(var(46)),Const(size.air.front)').length + MG.splitArgs('1, P2,Life, 3').length * 10;
    findings.redir = MG.compileList('EnemyNear(1),Alive')[0].f({ opponent: { alive: 1 } });
    return findings;
  });
  pass('[State n, label] attaches to the current Statedef', result.attach);
  pass('real-world expressions compile', result.bad.length === 0, result.bad.join(' | '));
  pass('AnimElem = n > t (no comma)', result.animelem[0] && !result.animelem[1], JSON.stringify(result.animelem));
  pass('EnemyNear(1) is absent in 1v1', !result.redir);
  pass('a redirection comma is not an argument separator', result.split === 31, String(result.split));
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
})();
