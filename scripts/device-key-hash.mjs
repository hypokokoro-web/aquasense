import { createHmac } from 'node:crypto';

const deviceKey = process.env.AQUASENSE_DEVICE_KEY;
const pepper = process.env.AQUASENSE_INGEST_KEY;
if (!deviceKey || deviceKey.length < 32 || deviceKey.length > 256) {
  console.error('Set AQUASENSE_DEVICE_KEY to the 32–256 character key provisioned to one device.');
  process.exit(1);
}
if (!pepper || pepper.length < 32) {
  console.error('Set AQUASENSE_INGEST_KEY to the server-side HMAC pepper (at least 32 characters).');
  process.exit(1);
}
process.stdout.write(createHmac('sha256', pepper).update(deviceKey, 'utf8').digest('hex') + '\n');
