import http from 'http';
import Docker from 'dockerode';

const auth = {
  username: process.env.DOCKER_REGISTRY_USERNAME,
  password: process.env.DOCKER_REGISTRY_PASSWORD,
  serveraddress: process.env.DOCKER_REGISTRY_URL
};

async function updateDockerServices(docker) {
  let servicesData = await docker.listServices();

  // Inspect services to get detailed data and sort them based on image name
  servicesData = await Promise.all(
    servicesData.map(async (serviceData) => {
      const service = docker.getService(serviceData.ID);
      const existingService = await service.inspect();
      return { service, existingService };
    })
  );

  servicesData.sort((a, b) => {
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

  // Update services
  for (let { service, existingService } of servicesData) {
    const imageName = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@')[0];
    const currentImageHash = existingService.Spec.TaskTemplate.ContainerSpec.Image.split('@')[1];

    // Pull the new image, with auth options
    try {
      console.log('pulling', imageName);
      if (imageName.startsWith(auth.serveraddress)) {
        await docker.pull(
          imageName,
          {
            authconfig: auth
          }
        );
      } else {
        await docker.pull(
          imageName
        );
      }
    } catch (error) {
      console.log(error);
      continue;
    }

    // Get the new image's hash
    const newImage = await docker.getImage(imageName).inspect();
    const newImageHash = newImage.RepoDigests[0].split('@')[1];

    // If the new image hash is different from the current service's image hash, update the service
    if (newImageHash !== currentImageHash) {
      const updateOpts = {
        ...existingService.Spec,
      }

      updateOpts.version = existingService.Version.Index;
      updateOpts.TaskTemplate.ForceUpdate = existingService.Spec.TaskTemplate.ForceUpdate + 1;

      await service.update(updateOpts);
      console.log(`Service ${existingService.Spec.Name} updated!`);
    } else {
      console.log(`Service ${existingService.Spec.Name} not updated as image is the same!`);
    }
  }
}

let timer;
export default function createServer (docker, debounce = 10000) {
  docker = docker || new Docker();

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        console.log('Webhook received!', body);
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            await updateDockerServices(docker);
          } catch (err) {
            console.error(`Error updating services: ${err}`);
          }
        }, debounce);
        res.end('ok');
      });
    } else {
      res.end('Invalid request');
    }
  });
}
