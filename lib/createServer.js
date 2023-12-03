import http from 'http';
import Docker from 'dockerode';
import finalStream from 'final-stream';

const authconfig = {
  username: process.env.DOCKER_REGISTRY_USERNAME,
  password: process.env.DOCKER_REGISTRY_PASSWORD,
  serveraddress: process.env.DOCKER_REGISTRY_URL
};

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

    console.log('Updating Service', service.id);
    if (authconfig.serveraddress && imageName.startsWith(authconfig.serveraddress)) {
      console.log('  attempting to pull', imageName)
      const stream = await docker.pull(imageName, { authconfig });
      await finalStream(stream);
      console.log('  pull finished');
    }

    console.log('  image:', imageName);
    const image = await docker.getImage(imageName).inspect().catch(() => null);
    if (!image) {
      console.log(`  (no image for: ${imageName})`);
      continue;
    }

    const latestImageDigest = image.RepoDigests[0].split('@')[1];
    console.log('  latestImageDigest:', latestImageDigest);
    console.log('  currentImageDigest', currentImageDigest);

    if (currentImageDigest !== latestImageDigest) {
      console.log('Updating service');
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

      console.log('  🟡 Update requested for', imageName);
      console.log('\n');
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
