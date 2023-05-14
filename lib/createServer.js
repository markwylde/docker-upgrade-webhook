import http from 'http';
import Docker from 'dockerode';

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
    const updateOpts = {
      ...existingService.Spec
    }

    updateOpts.version = existingService.Version.Index;
    updateOpts.TaskTemplate.ForceUpdate = updateOpts.TaskTemplate.ForceUpdate + 1;

    await service.update(updateOpts);
    console.log(`Service ${existingService.Spec.Name} updated!`);
  }
}

export default function createServer (docker) {
  docker = docker || new Docker();

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        console.log('Webhook received!', body);
        try {
          await updateDockerServices(docker);
        } catch (err) {
          console.error(`Error updating services: ${err}`);
        }
        res.end('ok');
      });
    } else {
      res.end('Invalid request');
    }
  });
}
