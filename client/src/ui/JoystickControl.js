import nipplejs from 'nipplejs';

export class JoystickControl {
  constructor() {
    this.dx = 0;
    this.dy = 0;
    this._joystick = null;
    this._onDash = null;
  }

  create(onDash) {
    this._onDash = onDash;
    this._createJoystickZone();
    this._createDashButton();
  }

  _createJoystickZone() {
    const zone = document.createElement('div');
    zone.id = 'joystick-zone';
    Object.assign(zone.style, {
      position: 'fixed',
      left: '0', bottom: '0',
      width: '50%', height: '45%',
      zIndex: '100',
    });
    document.body.appendChild(zone);

    this._joystick = nipplejs.create({
      zone,
      mode: 'dynamic',
      restJoystick: true,
      color: 'rgba(255,255,255,0.25)',
      size: 100,
    });

    this._joystick.on('move', (_, data) => {
      if (data.vector) {
        this.dx = data.vector.x;
        this.dy = -data.vector.y;
      }
    });
    this._joystick.on('end', () => {
      this.dx = 0;
      this.dy = 0;
    });
  }

  _createDashButton() {
    const btn = document.createElement('button');
    btn.id = 'dash-btn';
    btn.textContent = 'DASH';

    const press = () => { if (this._onDash) this._onDash(); };

    btn.addEventListener('touchstart', press, { passive: true });
    btn.addEventListener('mousedown', press);

    document.body.appendChild(btn);
  }

  destroy() {
    if (this._joystick) this._joystick.destroy();
    document.getElementById('joystick-zone')?.remove();
    document.getElementById('dash-btn')?.remove();
    this.dx = 0;
    this.dy = 0;
  }
}
