const axios = require("axios");
jest.mock("axios");
let formDataMockedInstances = [];

jest.mock("form-data", () => {
  const FormData = function () {
    const instance = {
      append: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({}),
    };
    formDataMockedInstances.push(instance);
    return instance;
  };
  return FormData;
});
jest.mock("../../../lib/util/index", () => {
  return {
    getConfigurations: jest.fn().mockReturnValue({ repositoryId: "123" }),
  };
});
const FormData = require("form-data");
const { getConfigurations } = require("../../../lib/util/index");
const createAttachment = require("../../../lib/handler/index").createAttachment;
const deleteAttachment = require("../../../lib/handler/index").deleteAttachment;

describe("handlers", () => {
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
  });

  describe("deleteAttachment()", () => {
    beforeEach(() => {
      axios.post.mockClear();
    });

    it("should perform the delete operation for given attachment", async () => {
      axios.post.mockResolvedValueOnce({ data: "Deleted" });
      const credentials = { uri: "http://localhost/" };
      const token = "demo-token";
      const objectId = "demo-objectId";
      const attachments = {};

      const response = await deleteAttachment(
        credentials,
        token,
        objectId,
        attachments
      );
      expect(response.data).toBe("Deleted");
      expect(axios.post).toHaveBeenCalledWith(
        `${credentials.uri}browser/123/root`,
        expect.objectContaining({
          append: expect.any(Function),
          getHeaders: expect.any(Function),
        }),
        { headers: expect.any(Object) }
      );
    });

    it("should throw error when delete operation fails", async () => {
      const error = new Error("Delete operation failed");
      axios.post.mockRejectedValueOnce(error);
      const credentials = { uri: "http://localhost/" };
      const token = "demo-token";
      const objectId = "demo-objectId";
      const attachments = {};

      const response = await deleteAttachment(
        credentials,
        token,
        objectId,
        attachments
      );

      expect(response).toBeInstanceOf(Error);
      expect(response.message).toBe(error.message);

      expect(axios.post).toHaveBeenCalledWith(
        `${credentials.uri}browser/123/root`,
        expect.objectContaining({
          append: expect.any(Function),
          getHeaders: expect.any(Function),
        }),
        { headers: expect.any(Object) }
      );
    });
  });
});
