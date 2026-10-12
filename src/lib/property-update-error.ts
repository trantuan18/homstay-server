type DatabaseError = {
  code?: string;
  message?: string;
};

export function describePropertyUpdateError(error: DatabaseError) {
  switch (error.code) {
    case "23505":
      return {
        code: "DUPLICATE_PROPERTY_VALUE",
        message: "A property with this name or slug already exists.",
      };
    case "23503":
      return {
        code: "INVALID_PROPERTY_REFERENCE",
        message: "The selected owner does not exist.",
      };
    case "23514":
      return {
        code: "PROPERTY_VALUE_NOT_ALLOWED",
        message: "One or more property values violate a database rule.",
      };
    case "22P02":
      return {
        code: "INVALID_PROPERTY_VALUE",
        message: "One or more fields have an invalid value or format.",
      };
    case "42501":
      return {
        code: "PROPERTY_UPDATE_FORBIDDEN",
        message: "You do not have permission to update this property.",
      };
    default:
      return {
        code: "PROPERTY_UPDATE_FAILED",
        message: `Could not save property${error.message ? `: ${error.message}` : "."}`,
      };
  }
}
