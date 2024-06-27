# Local testing of @cap-js/sdm plugin


XSUAA is required to enforce authentication for any CAP Application. To test the plugin locally, follow the given steps

## Configuring XSUAA 

1. Log in to the required space on the cloud foundry using cf cli as below:

```sh
   cf l -a <api-endpoint>
```

2. Go to the CAP project location and configure your app for XSUAA-based authentication:

```sh
   cds add xsuaa 
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


4. Create an XSUAA service instance with this configuration:

```sh
    cf create-service xsuaa application bookshop-uaa -c xs-security.json
```

5. Create a service key:

```sh
    cf create-service-key bookshop-uaa bookshop-uaa-key
```

6. Bind to the new service key:

```sh
    cds bind --to bookshop-uaa:bookshop-uaa-key
```

7. Go to the BTP subaccount and add the required users under the Role collections to allow user authentication and authorization.




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
    "PORT": 5000,
    "destinations": [
        {
            "name": "srv_api",
                "url": "http://localhost:4004",
                "forwardAuthToken": true,
                "strictSSL": false
        }
    ],
    "VCAP_SERVICES": {
        "xsuaa": [
            {
                "tags": [
                    "xsuaa"
                ],
                "credentials": { SERVICE KEY VALUE }
            }
        ]
    }
}
```


4. Install npm packages for approuter:

```sh
    npm install --prefix app/approuter
```

## Configuring @cap-js/sdm plugin and running the application

1.  Bind to the SDM service
   ```sh
   cds bind sdm -2 <INSTANCE-NAME>:<SERVICE-KEY> --kind sdm
   ```
This generates a new file .cdsrc-private.json in the project folder.
2. In the project folder run in one terminal window:

```sh
    cds bind --exec -- npm start --prefix app/approuter
```
3. Run in another terminal window:

```sh
    cds watch --profile hybrid
```

4. Open http://localhost:5000 in the browser which redirects to the port 4004 and the application can be accessed locally.



