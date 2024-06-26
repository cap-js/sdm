# Local testing of @cap-js/sdm plugin

XSUAA is required to enforce authentication for any CAP Application. To test the plugin locally, follow the given steps

## Configuring XSUAA 

1. Log in to the required space on the cloud foundry using cf cli as below:

```sh
   cf l -a <api-endpoint>
```

2. Go to the CAP project location and configure your app for XSUAA-based authentication:

```sh
   cds add xsuaa --for hybrid
```

This command creates the XSUAA configuration file xs-security.json and adds the service and required dependencies to the package.json file

3. Make sure xsappname is configured and tenant-mode is set to dedicated in xs-security.json file:

```sh
    {
        "xsappname": "bookshop-hybrid",
        "tenant-mode": "dedicated",
        ...
    }
```

4. Configure the redirect URI by adding the following OAuth configuration to the xs-security.json file:

```sh
    "oauth2-configuration": {
        "redirect-uris": [
            "http://localhost:5000/"
        ]
    }
```

5. Create an XSUAA service instance with this configuration:

```sh
    cf create-service xsuaa application bookshop-uaa -c xs-security.json
```

6. Create a service key:

```sh
    cf create-service-key bookshop-uaa bookshop-uaa-key
```

7. Bind to the new service key:

```sh
    cds bind -2 bookshop-uaa
```

8. Add an auth section containing the binding and the kind xsuaa to the .cdsrc-private.json file. 

```sh
    {
        "requires": {
            "[hybrid]": {
                "auth": {
                    "kind": "xsuaa",
                    "binding": { ... }
                }
            }
        }
    }
```

9. Verify if the .cds file under srv folder has

```sh
    @requires: 'authenticated-user'
```

10. Go to the BTP subaccount and add the required users under the Role collections.




## Running Approuter​

The approuter component implements the necessary authentication flow with XSUAA to let the user log in interactively. The resulting JWT token is sent to the application where it's used to enforce authorization and check the user's roles.

1. Add approuter to the app folder of the project:

```sh
    cds add approuter
```

If package.json is not found create a file named package.json and add the below:

```sh
    {
        "name": "approuter",
        "description": "Node.js application router for CAP",
        "dependencies": {
            "@sap/approuter": "^14"
        },
        "scripts": {
            "start": "node node_modules/@sap/approuter/approuter.js"
        },
        "engines": {
            "node": "^12.0.0 || ^14"
        }
    }
```

2. Create a file named xs-app.json and add the below:

```sh
    {
        "authenticationMethod": "route",
        "logout": {
            "logoutEndpoint": "/do/logout"
        },
        "routes": [{
            "source": "^/(.*)$",
            "target": "$1",
            "authenticationType": "xsuaa",
            "destination": "srv_api",
            "csrfProtection": false
        }]
    }
```

3. Create default-env.json and add the following:

```sh
    {
        "destinations": [
            {
                "name": "srv_api",
                "url": "http://localhost:4004",
                "forwardAuthToken": true,
                "strictSSL": false
            }
        ]
    }
```

4. Create default-services.json. Fetch the xsuaa content from the VCAP_SERVICES of the CAP Application and paste the content to file default-services.json: 

```sh
    { "uaa": {
            
        }
    }
```

Copy this file to the root directory of our project because in the service, the JWT token needs to be validated. Here rename uaa to xsuaa:  

```sh
    { "xsuaa": {
            
        }
    }
```

5. Install npm packages for approuter:

```sh
    npm install --prefix app/approuter
```

6. In the project folder run:

```sh
    cds bind --exec -- npm start --prefix app/approuter
```

7. Make sure that the CAP application is running as well with the hybrid profile in another terminal:

```sh
    cds watch --profile hybrid
```

8. Open http://localhost:5000 in the browser which redirects to the port 4004 and the application can be accessed locally.



