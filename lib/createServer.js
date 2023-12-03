import http from 'http';
import Docker from 'dockerode';
import finalStream from 'final-stream';
import fs from 'fs';
import path from 'path';

function readDockerConfig(domain) {
  const dockerConfigPath = path.join(process.env.HOME || '/', '.docker/config.json');
  if (!fs.existsSync(dockerConfigPath)) {
    console.error('Docker config file not found');
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf8'));
    if (config.auths && config.auths[domain]) {
      const auth = config.auths[domain];
      const authBuffer = Buffer.from(auth.auth, 'base64');
      const [username, password] = authBuffer.toString('utf8').split(':');
      return { username, password, serveraddress: domain };
    }
  } catch (err) {
    console.error('Error reading Docker config:', err);
    return null;
  }
}

async function getServicesData(docker) {
  let servicesData = await docker.listServices();

  return await Promise.all(
    servicesData.map(async (serviceData) => {
      const service = docker.getService(serviceData.ID);
      const existingService = await service.inspect();
      return { service, existingService };
    })
  );
}

async function updateDockerServices(docker) {
  console.log('Triggering updateDockerServices');
  const servicesData = await getServicesData(docker);

  for (let { service, existingService } of servicesData) {
    const [imageName, currentImageDigest] = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@');
    const domain = imageName.split('/')[0];
    console.log('Updating Service', service.id);
    const authconfig = readDockerConfig(domain);
    if (authconfig && imageName.startsWith(authconfig.serveraddress)) {
      console.log('  attempting to pull', imageName);
      const stream = await docker.pull(imageName, { authconfig });
      await finalStream(stream);
      console.log('  pull finished');
    }

    console.log('  image:', imageName);
    const image = await docker.getImage(imageName).inspect().catch(() => null);
    if (!image) {
      console.log(`  (image not found)`);
      continue;
    }

    const latestImageDigest = image.RepoDigests[0].split('@')[1];
    console.log('  latestImageDigest:', latestImageDigest);
    console.log('  currentImageDigest:', currentImageDigest);

    if (currentImageDigest !== latestImageDigest) {
      console.log('  🟡 service is out of date');
      await service.update({
        ...existingService.Spec,
        version: existingService.Version.Index,
        TaskTemplate: {
          ...existingService.Spec.TaskTemplate,
          ContainerSpec: {
            ...existingService.Spec.TaskTemplate.ContainerSpec,
            Image: imageName + '@' + latestImageDigest,
          },
          ForceUpdate: existingService.Spec.TaskTemplate.ForceUpdate + 1
        }
      });

      console.log('  🟢 update triggered');
    }
  }
}

let timer;
async function handleWebhook(req, res, docker) {
  const body = req.method === 'POST' && await finalStream(req);

  console.log('Webhook received!', body.toString());

  const DEBOUNCE = parseInt(process.env.DEBOUNCE || '10000');
  clearTimeout(timer);
  setTimeout(async () => {
    try {
      await updateDockerServices(docker);
    } catch (err) {
      console.error(`Error updating services: ${err}`);
    }
  }, DEBOUNCE);

  res.end('ok');
}

export default async function createServer (docker) {
  docker = docker || new Docker();
  try {
    updateDockerServices(docker);
  } catch (err) {
    console.error(`Error updating services: ${err}`);
  }

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      handleWebhook(req, res, docker);
    } else {
      res.end('Invalid request');
    }
  });
}
