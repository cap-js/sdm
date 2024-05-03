const axios = require("axios");
jest.mock("axios");
jest.mock("form-data", () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({}),
  }));
});
jest.mock("../../../lib/util/index", () => {
  return {
    getConfigurations: jest.fn().mockReturnValue({ repositoryId: "1234" }),
  };
});
const FormData = require("form-data");
const { getConfigurations } = require("../../../lib/util/index");
const createAttachment = require("../../../lib/handler/index").createAttachment;

describe("createAttachment function", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns response from updateServerRequest", async () => {
    const response = { data: "response" };
    axios.post.mockResolvedValue(response);

    const result = await createAttachment(
      {},
      { uri: "http://test.com" },
      "token",
      {}
    );

    expect(result).toBe(response);
    expect(axios.post).toHaveBeenCalled();
  });

  it("calls getConfigurations", async () => {
    await createAttachment({}, {}, "", {});

    expect(getConfigurations).toHaveBeenCalledTimes(1);
  });

  it("populates and sends FormData correctly", async () => {
    const formDataInstance = new FormData();
    await createAttachment(
      { filename: "test", content: "test content" },
      {},
      "",
      {}
    );

    expect(formDataInstance.append).toHaveBeenCalledTimes(7);
  });

  it("calls updateServerRequest with correct arguments", async () => {
    const data = { filename: "test", content: "test content", ID: "123" };
    const credentials = { uri: "http://test.com/" };
    const token = "token";
    const attachments = {};
    const repositoryId = "repo-id";
    getConfigurations.mockReturnValue({ repositoryId });
    const documentCreateURL = `${credentials.uri}browser/${repositoryId}/root`;
    const config = { headers: { Authorization: `Bearer ${token}` } };

    await createAttachment(data, credentials, token, attachments);

    expect(updateServerRequest).toHaveBeenCalledWith(
      documentCreateURL,
      new FormData(),
      config,
      attachments,
      data.ID
    );
  });
});
