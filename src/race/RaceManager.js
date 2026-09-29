// RaceManager: 「普通のマラソン」を担当する。カメラや世界がどれだけ壊れても、ここは変わらない。
// タイトル → カウントダウン → レース → ゴール → リザルト の状態と、順位・記録を管理する。

export const RACE = {
  TITLE: 'title',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  FINISHING: 'finishing',
  RESULT: 'result',
};

export class RaceManager {
  constructor(bus, distance, ai, player) {
    this.bus = bus;
    this.distance = distance;
    this.ai = ai;
    this.player = player;
    this.state = RACE.TITLE;
    this.total = ai.n + 1;
    this.recentOvertakes = [];

    bus.on('overtake', (e) => this.onOvertake(e));
    bus.on('playerFall', () => this.stats.falls++);
    this.resetStats();
  }

  resetStats() {
    this.stats = { overtakes: 0, falls: 0, nearMiss: 0, finishTime: 0, finishPosition: 0, bestPosition: this.total };
    this.position = this.total;
    this.leader = false;
  }

  get goalS() {
    return this.distance.goalUnits;
  }

  get running() {
    return this.state === RACE.RUNNING;
  }

  startCountdown() {
    this.state = RACE.COUNTDOWN;
    this.countdown = 3;
    this.resetStats();
    this.distance.reset();
    this.bus.emit('countdown', { n: 3 });
    this.lastCount = 3;
  }

  onOvertake(e) {
    if (this.state !== RACE.RUNNING || !e.first) return;
    this.stats.overtakes++;
    const now = performance.now();
    this.recentOvertakes = this.recentOvertakes.filter((t) => now - t < 1500);
    this.recentOvertakes.push(now);
    this.bus.emit('overtakeScored', { ...e, burst: this.recentOvertakes.length });
  }

  update(dt) {
    if (this.state === RACE.COUNTDOWN) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) this.bus.emit('countdown', { n });
        else {
          this.state = RACE.RUNNING;
          this.bus.emit('raceStart', {});
        }
      }
    }

    if (this.state === RACE.RUNNING || this.state === RACE.FINISHING) {
      if (this.state === RACE.RUNNING) this.distance.advanceClock(dt);
      const pos = this.ai.rankOf(this.player.s);
      if (pos !== this.position) {
        const tookLead = pos === 1 && this.position !== 1;
        this.position = pos;
        if (tookLead && this.state === RACE.RUNNING) this.bus.emit('takeLead', {});
      }
      this.stats.bestPosition = Math.min(this.stats.bestPosition, this.position);
    }

    if (this.state === RACE.RUNNING && this.player.s >= this.goalS) {
      this.state = RACE.FINISHING;
      this.player.finished = true;
      this.stats.finishTime = this.distance.raceTime;
      this.stats.finishPosition = this.position;
      this.bus.emit('finish', { position: this.position, time: this.distance.raceTime });
    }
  }

  showResult() {
    this.state = RACE.RESULT;
  }

  toTitle() {
    this.state = RACE.TITLE;
  }
}
