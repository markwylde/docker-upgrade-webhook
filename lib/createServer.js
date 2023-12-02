import http from 'http';
import Docker from 'dockerode';
import finalStream from 'final-stream';
import pRetry from 'p-retry';

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

async function getServiceImageIds(docker, serviceName) {
  console.log('Attempting to get imageIds for', serviceName);
  const services = await docker.listServices();
  const service = services.find(s => s.Spec.Name === serviceName);

  if (!service) {
    console.log('Service not found');
    return;
  }

  const tasks = await docker.listTasks({filters: {service: [service.ID]}});

  if (tasks.length === 0) {
    console.log('No tasks found for this service');
    return;
  }

  const runningTasks = tasks.filter(task => task.DesiredState === 'running');

  const imageIds = await Promise.all(runningTasks.map(async task => {
    if (task.Status && task.Status.ContainerStatus && task.Status.ContainerStatus.ContainerID) {
      const containerId = task.Status.ContainerStatus.ContainerID;
      const container = docker.getContainer(containerId);
      const containerInfo = await container.inspect();
      return containerInfo.Image;
    } else {
      return null;
    }
  }));

  return [...new Set(imageIds.filter(id => id))];
}

async function updateDockerServices(docker) {
  console.log('Triggering updateDockerServices');
  const servicesData = await getServicesData(docker);

  for (let { service, existingService } of servicesData) {
    const imageName = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@')[0];
    const serviceInfo = await service.inspect();

    const currentImageIds = await pRetry(
      () => getServiceImageIds(docker, serviceInfo.Spec.Name),
      {
        retries: 100,
        onFailedAttempt: async error => {
          console.log(error);
        }
      }
    );
    if (authconfig.serveraddress && imageName.startsWith(authconfig.serveraddress)) {
      console.log('Attempting to pull', imageName)
      await docker.pull(imageName, { authconfig });
    }

    console.log('Getting image information for', imageName);
    const image = await docker.getImage(imageName).inspect().catch(() => null);
    if (!image) {
      console.log('No image for', imageName);
      continue;
    }
    const latestImageId = image.Id
    console.log(imageName);
    console.log('latestImageId:', latestImageId);
    console.log('currentImageIds', currentImageIds);

    if (currentImageIds?.find(imageId => imageId !== latestImageId)) {
      console.log('Updating service');
      await service.update({
        ...existingService.Spec,
        version: existingService.Version.Index,
        TaskTemplate: {
          ...existingService.Spec.TaskTemplate,
          ForceUpdate: existingService.Spec.TaskTemplate.ForceUpdate + 1
        }
      });

      console.log('Update requested for', imageName);
      console.log('\n');
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

export default async function createServer (docker, debounce='0,1000,3000,6000') {
  docker = docker || new Docker();
  try {
    updateDockerServices(docker);
  } catch (err) {
    console.error(`Error updating services: ${err}`);
  }

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      handleWebhook(req, res, docker, debounce);
    } else {
      res.end('Invalid request');
    }
  });
}
