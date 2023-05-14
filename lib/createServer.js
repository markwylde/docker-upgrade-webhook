import http from 'http';
import Docker from 'dockerode';
import finalStream from 'final-stream';

const auth = {
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

function sortServicesData(servicesData) {
  return servicesData.sort((a, b) => {
    const aImage = a.existingService.Spec.TaskTemplate.ContainerSpec.Image;
    const bImage = b.existingService.Spec.TaskTemplate.ContainerSpec.Image;

    const aIsSpecial = aImage.startsWith('ghcr.io/markwylde/docker-upgrade-webhook:');
    const bIsSpecial = bImage.startsWith('ghcr.io/markwylde/docker-upgrade-webhook:');

    if (aIsSpecial && !bIsSpecial) {
      return 1;
    } else if (!aIsSpecial && bIsSpecial) {
      return -1;
    } else {
      return 0;
    }
  });
}

async function pullImageIfNeeded(docker, imageName, pulledImages) {
  if (!pulledImages.has(imageName)) {
    if (auth.serveraddress && imageName.startsWith(auth.serveraddress)) {
      console.log('pulling', imageName);
      await docker.pull(imageName, { authconfig: auth });
    } else {
      console.log('not pulling', imageName, 'as not from DOCKER_REGISTRY_URL');
      // await docker.pull(imageName);
    }
    pulledImages.add(imageName);
  }
}

async function updateServiceIfChanged(service, existingService, imageName, docker) {
  const currentImageHash = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@')[1];
  const newImage = await docker.getImage(imageName).inspect();
  const newImageHash = newImage.RepoDigests[0].split('@')[1];

  if (newImageHash !== currentImageHash) {
    const updateOpts = {
      ...existingService.Spec,
      version: existingService.Version.Index,
      TaskTemplate: {
        ...existingService.Spec.TaskTemplate,
        ForceUpdate: existingService.Spec.TaskTemplate.ForceUpdate + 1
      }
    };

    await service.update(updateOpts);
    console.log(`Service ${existingService.Spec.Name} updated!`);
  } else {
    console.log(`Service ${existingService.Spec.Name} not updated as image is the same!`);
  }
}

async function updateDockerServices(docker) {
  console.log('Triggering updateDockerServices');
  let servicesData = await getServicesData(docker);
  servicesData = sortServicesData(servicesData);

  const pulledImages = new Set();

  for (let { service, existingService } of servicesData) {
    const imageName = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@')[0];

    try {
      await pullImageIfNeeded(docker, imageName, pulledImages);
      await updateServiceIfChanged(service, existingService, imageName, docker);
    } catch (error) {
      console.log(error);
    }
  }
}

let timer;

async function handleWebhook(req, res, docker, debounce) {
  const body = req.method === 'POST' && await finalStream(req);

  console.log('Webhook received!', body.toString());

  clearTimeout(timer);

  const delays = debounce.split(',').map(Number);

  timer = setTimeout(async () => {
    for (const delay of delays) {
      try {
        console.log('Will update all services in', delay, 'ms')
        await new Promise(resolve => setTimeout(resolve, delay));
        await updateDockerServices(docker);
      } catch (err) {
        console.error(`Error updating services: ${err}`);
      }
    }
  }, 0);

  res.end('ok');
}

export default function createServer (docker, debounce='0,1000,3000,6000') {
  docker = docker || new Docker({
    socketPath: '/Users/markwylde/.docker/run/docker.sock'
  });

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      handleWebhook(req, res, docker, debounce);
    } else {
      res.end('Invalid request');
    }
  });
}
