# CAP plugin for SAP Document Management Service

The **@cap-js/sdm** package is [cds-plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) that provides out-of-the box asset storage and handling by using an aspect Attachments. It also provides a CAP-level, easy to use integration of the SAP Document Management Repository like SAP Object Store.  
This plugin can be consumed by the CAP application deployed on BTP to store their documents in the form of attachments in Document Management Repository.

### Table of Contents

- [Setup](#setup)
- [Use `attachments-sdm`](#use-attachments-sdm)
- [Test-drive Hybrid](#test-drive-hybrid)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)

## Setup

To enable attachments-sdm, simply add this self-configuring plugin package to your project:

```sh
 npm add @cap-js/attachments-sdm
```

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base application, to add `Attachments` type to the CDS model.

> [!Note]
> To be able to use the Fiori _uploadTable_ feature, you must ensure ^1.121.0 SAPUI5 version is updated in the application's _index.html_

## Use Attachments-sdm

**To use Attachments-sdm, create an element with an `Attachments` type.** Following the [best practice of separation of concerns](https://cap.cloud.sap/docs/guides/domain-modeling#separation-of-concerns), we do so in a separate file _db/attachments.cds_:

```
using { sap.capire.incidents as my } from './schema';
using { Attachments } from '@cap-js/attachments';

extend my.Incidents with { attachments: Composition of many Attachments }
```

**Create a SAP Document Management Service instance and key. Using the contents from key onboard a repository and configure the onboarded repositoryId under cds.requires in package.json**

```
"attachments-sdm": {
   "settings": {
   "repositoryId": "<repository-Id>"
   }
}
```

## Test-drive Hybrid

For using SAP Document Management Service as storage option, use the instance and key values of SAP Document Management Service in the below setup.

1. Log in to Cloud Foundry space:

   ```sh
   cf login -a <CF-API> -o <ORG-NAME> -s <SPACE-NAME>
   ```

2. To bind to the service continue with the steps below.

   In the project directory, you can generate a new file \_.cdsrc-private.json by running:

   ```sh
   cds bind attachments -2 <INSTANCE>:<SERVICE-KEY> --kind sdm
   ```

3. **Start the server**:

- _Default_ scenario (In memory database):
  ```sh
  cds watch --profile hybrid
  ```

4. **Navigate to the object page** of the incident `Solar panel broken`:

   Go to [Object page for incident **Solar panel broken**](<http://localhost:4004/incidents/app/#/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true)>)

5. The `Attachments` type has generated an out-of-the-box Attachments table (see 1) at the bottom of the Object page:
   <img width="1300" alt="Attachments Table" style="border-radius:0.5rem;" src="etc/facet.png">

6. **Upload a file** by going into Edit mode and either using the **Upload** button on the Attachments table or by drag/drop. Then click the **Save** button to have that file stored in SAP Document Management Integration Option. We demonstrate this by uploading the PDF file from [_xmpl/db/content/Solar Panel Report.pdf_](./xmpl/db/content/Solar%20Panel%20Report.pdf):
   <img width="1300" alt="Upload an attachment" style="border-radius:0.5rem;" src="etc/upload.gif">

7. **Delete a file** by going into Edit mode and selecting the file(s) and by using the **Delete** button on the Attachments table. Then click the **Save** button to have that file deleted from the resource (SAP Document Management Integration Option). We demonstrate this by deleting the previously uploaded PDF file: `Solar Panel Report.pdf`
   <img width="1300" alt="Delete an attachment" style="border-radius:0.5rem;" src="etc/delete.gif">

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/sdm/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and <your-project> contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/sdm).
