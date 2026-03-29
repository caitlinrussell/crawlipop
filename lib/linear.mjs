const LINEAR_API_URL = "https://api.linear.app/graphql";

async function callLinear({ apiKey, query, variables = {} }) {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Linear request failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message).join("; "));
  }

  return payload.data;
}

export async function listTeams(apiKey) {
  const data = await callLinear({
    apiKey,
    query: `
      query Teams {
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    `
  });

  return data.teams.nodes;
}

export async function createIssue({ apiKey, teamId, title, description }) {
  const data = await callLinear({
    apiKey,
    query: `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
          }
        }
      }
    `,
    variables: {
      input: {
        teamId,
        title,
        description
      }
    }
  });

  if (!data.issueCreate.success) {
    throw new Error("Linear did not confirm issue creation.");
  }

  return data.issueCreate.issue;
}
