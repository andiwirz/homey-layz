'use strict';

const Homey = require('homey');
const { BestwaySmarthubClient } = require('../../lib/BestwaySmarthubClient');

class LaZSpaConnectDriver extends Homey.Driver {

  async onInit() {
    this.log('Lay-Z-Spa Connect driver initialized');

    this._triggerTempReached    = this.homey.flow.getDeviceTriggerCard('spa_temp_reached');
    this._triggerErrorTriggered = this.homey.flow.getDeviceTriggerCard('spa_error_triggered');

    this._triggerFilterPumpChanged   = this.homey.flow.getDeviceTriggerCard('filter_pump_changed');
    this._triggerFilterPumpTurnedOn  = this.homey.flow.getDeviceTriggerCard('filter_pump_turned_on');
    this._triggerFilterPumpTurnedOff = this.homey.flow.getDeviceTriggerCard('filter_pump_turned_off');
    // Flow card run listeners are registered centrally in the Lay-Z driver, which
    // initialises last and whose listeners handle both Lay-Z and Connect devices.
  }

  async onRepair(session, device) {
    this.log('Repair session started for:', device.getName());

    session.setHandler('link_code', async ({ code }) => {
      const shareCode      = (code ?? '').trim();
      const existingRegion = device.getStoreValue('region') ?? 'eu';
      const visitorId      = device.getStoreValue('visitorId');

      this.log('Repair: received share code, trying regions…');

      const regionsToTry = [...new Set([existingRegion, existingRegion === 'eu' ? 'us' : 'eu'])];
      let client  = null;
      let lastErr = null;

      for (const region of regionsToTry) {
        try {
          const c = new BestwaySmarthubClient({ region, visitorId });
          await c.authenticate();
          await c.linkShareCode(shareCode);
          client = c;
          this.log(`Repair: share code accepted (${region})`);
          break;
        } catch (err) {
          lastErr = err;
          this.log(`Repair: region "${region}" failed:`, err.message);
        }
      }

      if (!client) {
        this.error('Repair: all regions failed:', lastErr?.message);
        throw new Error(lastErr?.message ?? 'Repair failed');
      }

      await device.setStoreValue('token',     client._token);
      await device.setStoreValue('region',    client.region);
      await device.setStoreValue('visitorId', client.visitorId);

      device._initClient();
      device.setAvailable().catch(err => this.log('Repair: setAvailable failed:', err.message));
      this.log('Repair: credentials updated successfully.');
      return true;
    });
  }

  async onPair(session) {
    let _pendingDevices = [];

    session.setHandler('link_code', async ({ code }) => {
      const shareCode = (code ?? '').trim();
      this.log('Pair: received share code, trying regions…');

      let client  = null;
      let lastErr = null;

      for (const region of ['eu', 'us']) {
        try {
          const c = new BestwaySmarthubClient({ region });
          await c.authenticate();
          await c.linkShareCode(shareCode);
          client = c;
          this.log(`Pair: share code accepted on region "${region}"`);
          break;
        } catch (err) {
          lastErr = err;
          this.log(`Pair: region "${region}" failed:`, err.message);
        }
      }

      if (!client) {
        this.error('Pair: all regions failed:', lastErr?.message);
        throw new Error(lastErr?.message ?? this.homey.__('pair.connect.error.link_failed'));
      }

      const rawDevices = await client.getDevices();
      this.log(`Pair: found ${rawDevices.length} device(s)`);

      if (!rawDevices.length) {
        throw new Error(this.homey.__('pair.connect.error.no_devices'));
      }

      _pendingDevices = rawDevices.map(device => ({
        name: device.device_alias || device.device_name || 'Lay-Z-Spa',
        data: {
          id: device.device_id,
        },
        store: {
          productId: device.product_id,
          visitorId: client.visitorId,
          token:     client._token,
          region:    client.region,
        },
      }));

      return true;
    });

    session.setHandler('list_devices', async () => _pendingDevices);
  }

}

module.exports = LaZSpaConnectDriver;
