# Contributing

## Code of Conduct

All members of the project community must abide by the [Contributor Covenant, version 2.1](CODE_OF_CONDUCT.md).
Only by respecting each other we can develop a productive, collaborative community.
Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by contacting [a project maintainer](.reuse/dep5).

## Engaging in Our Project

Thank you for your interest in contributing to the CAP plugin for SAP Document Management Service. Your assistance is much needed and appreciated. This document outlines how you can contribute, and specifies requirements you need to meet before submitting your contributions. Here are some ways in which you can contribute: 

* Reporting a bug 

* Discussing the current state of the code 

* Submitting a fix 

* Proposing new features 

We use GitHub to manage reviews of pull requests.

* If you are a new contributor, see: [Steps to Contribute](#steps-to-contribute)

* Before implementing your change, create an issue that describes the problem you would like to solve or the code that should be enhanced. Please note that you are willing to work on that issue. When creating an issue, make sure to label it. You can view the available labels here: [Issue labels](https://github.com/cap-js/sdm/labels)

* The team will review the issue and decide whether it should be implemented as a pull request. In that case, they will assign the issue to you. If the team decides against picking up the issue, the team will post a comment with an explanation.

## Issues and Planning

* We use GitHub issues to track bugs and enhancement requests.

* Please provide as much context as possible when you open an issue. The information you provide must be comprehensive enough to reproduce that issue for the assignee.

## Steps to Contribute

Should you wish to work on an issue, please claim it first by commenting on the GitHub issue that you want to work on. This is to prevent duplicated efforts from other contributors on the same issue.

If you have questions about one of the issues, please comment on them, and one of the maintainers will clarify.

Components that cannot be changed:

* Licensing: Any changes to software licenses won't be accepted. 
* Repository Structure: The project structure should remain unchanged unless changes are approved by the maintainers. 

Components that can be changed:

* Documentation: If you see any gaps in the documentation, feel free to fill it. This includes walkthroughs, diagrams, typographical errors, and more. 
* Bug Fixing: If you found any bugs, you can fix it and submit a pull request. 
* Features: You can suggest and work on new features or enhancements to existing features. 
* Performance: If you can optimise any part of the existing implementation, your contribution is greatly welcomed. 

To contribute, you can follow these steps:

1. Fork the repo and clone it to your local system. 
2. Add the original repository as a remote (use the alias "upstream"). 
3. If you created your fork a while ago be sure to pull upstream changes into your local repository. 
4. Create a new branch to work on from develop.
5. If you've added code that should be tested, add unit tests(/test/lib). Add comments to explain your changes. Make sure to check the code coverage for tests (>95%). For more information on testing, refer to [Running the unit tests](https://github.com/cap-js/sdm?tab=readme-ov-file#running-the-unit-tests).
6. Once you have made your changes, push your branch commits to the forked repository. 
7. From the original repository, click the "New pull request" button. 
8. Select your fork and the branch you worked on. 
9. The title of your PR should describe your changes. In the description, mention what you changed, why you changed it, and the issue related (with hashtag #issueNumber). Add labels to your PR such as bug, enhancement, documentation, consulting etc. 
10. After raising a PR, all tests - including linting, unit tests, and integration tests - will be executed. The PR will not be merged unless all these tests pass successfully. 

Some points to keep in mind while contributing:

1. Follow the code style of the project, including indentation. 
2. Ensure proper testing of the changes.
3. Make sure the code lints.

Once you submit a PR, the maintainers will review your submission. They might ask for changes or reject if your contribution doesn't match the project guidelines. If everything is fine, they will merge your PR. 

## Contributing Code or Documentation

You are welcome to contribute code in order to fix a bug or to implement a new feature that is logged as an issue.

The following rule governs code contributions:

* Contributions must be licensed under the [Apache 2.0 License](./LICENSE)
* Due to legal reasons, contributors will be asked to accept a Developer Certificate of Origin (DCO) when they create the first pull request to this project. This happens in an automated fashion during the submission process. SAP uses [the standard DCO text of the Linux Foundation](https://developercertificate.org/).



