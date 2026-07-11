# LifePass AI

**LifePass is a welfare decision-support platform that helps individuals enter information about their circumstances or upload relevant documents, identify welfare and public benefits they may qualify for, and organize the steps needed to prepare an application.**

LifePass AI reduces the burden of searching through policies one by one and helps users preview how their eligibility may change when their personal circumstances change.

![Main Page](docs/images/main_page.png)

---

## 1. The Problem LifePass AI Solves

Although many welfare policies are available, they can be difficult for ordinary users to evaluate on their own.

- Each policy applies different criteria for age, income, household type, region, monthly rent, deposit, and employment status.
- Eligibility may change not only based on the user's current situation, but also when they begin earning income or experience other changes several months later.
- Policy documents are often long and difficult to understand, making it hard for users to identify which conditions matter.
- Even when users may be eligible, they may not know which documents to prepare first.

LifePass provides the following workflow to reduce these difficulties:

1. The user enters personal information or uploads a document.
2. The platform extracts key information such as age, region, monthly income, monthly rent, deposit, employment status, and available documents.
3. The platform compares the user's information with registered policies.
4. It shows potentially available benefits, application preparation items, and possible changes in benefits caused by income changes.
5. When used with the policy ingestion server, the platform can retrieve policy candidates from external official APIs and add them to the platform's policy catalog after administrator review.

---

## 2. Target Users

The current version of LifePass AI is positioned as a **self-check platform for members of the general public**.

Example users include:

- Young adults who are burdened by monthly rent
- People who are looking for work after leaving a job
- People planning to start a part-time or short-term job
- People with low current income who expect their income to change in a few months
- People who want to organize available welfare benefits and application requirements in one place

Although the service may later be expanded into a system for counseling institutions, the current version is closer to a personal self-assessment service than an internal case-management system for agencies.

---

## 3. Key Features

### 3.1 Importing Personal Information

Users can upload PDF files, Word documents, text files, image files, and other materials to import information about their circumstances.

Examples include:

- Counseling notes
- Notes related to a housing lease
- Documents containing monthly rent, deposit, and income information
- Text files summarizing the user's circumstances
- Policy information documents

When a file is uploaded, the platform extracts key information such as:

- Age
- Region of residence
- Household type
- Monthly income
- Monthly rent
- Housing deposit
- Remaining unemployment benefit days
- Expected income several months later
- Available documents

If extracted information is incorrect or incomplete, the user can correct it directly in the editing area on the screen.

> The current version supports both free-text input and document upload. Users can describe their situation in natural language, such as “28 years old, living in Seoul, monthly rent of KRW 450,000,” or upload a document and then review the extracted values in the numeric and status editing area. All values used in the final assessment are shown on the screen so that users can correct them directly.

---

### 3.2 Benefits You May Qualify For

The platform compares the user's current information with registered policy criteria and shows benefits for which the user may be eligible.

This screen includes:

- Policies the user may qualify for
- Policies that require additional information
- Policies whose criteria are not met
- Estimated effects of each policy
- Explanations of the conditions that make the user eligible or ineligible

LifePass AI does not provide a final administrative determination. It is intended to help users review their circumstances before submitting an official application.

---

### 3.3 Welfare Cliff Preview

When income begins or increases, some benefits may be reduced or lost abruptly. LifePass AI helps users preview these changes.

For example, if a user currently has no income but plans to begin a part-time job earning KRW 800,000 per month in three months, the user can review:

- Benefits available now
- Benefits that may change after the expected income begins
- Policies for which eligibility may decrease because of the income increase
- Whether the order of applications should be adjusted

This feature goes beyond showing whether a user qualifies for a specific benefit. It is designed to help users make safer decisions as their circumstances change.

---

### 3.4 Preparing an Application

When a user may qualify for a policy, LifePass organizes the next steps.

For example, it may show:

- Information that should be confirmed first
- Documents that should be prepared
- Conditions that should be checked again before applying
- Items that should be verified through the official application channel
- Cases where confirmation from a counselor or responsible institution is required

LifePass AI does not submit applications on behalf of users. Its role is to help users identify missing conditions or documents before they apply through an official institution.

---

### 3.5 Reviewing the Basis for a Decision

Users can review why a particular benefit was recommended and which information was used in the assessment.

This screen may show:

- User information used in the assessment
- Policy-by-policy comparison results
- Items that still need confirmation
- Policy ingestion management status
- Policy candidates waiting for review
- Number of approved policies

When automated policy ingestion is enabled, administrators can review, approve, or reject collected policy candidates from this screen.

The legal-basis section also shows laws and regulations related to policy recommendations. Legal data does not represent a benefit that the user can receive directly. Instead, it serves as reference material showing the legal and institutional basis for a policy.

For example, housing benefit policies may be connected to the Housing Benefits Act or the National Basic Living Security Act, while employment support policies may be connected to the Employment Insurance Act or legislation related to the National Employment Support Program.

This information helps users understand why a policy was recommended, which eligibility conditions have a legal basis, and which official source documents should be reviewed before applying or receiving counseling.

---

## 4. Policy Data Management

LifePass AI follows the principle below when collecting policy data:

> Prioritize official APIs and use permitted supplementary collection only in a limited manner.

Information available through official APIs such as Bokjiro, Government24, and the Public Data Portal is collected through APIs first. Local-government announcements that are not yet reflected in APIs may be collected only from URLs explicitly approved by the operator.

The automated policy ingestion workflow is as follows:

1. Retrieve policy source documents from an official API or an approved announcement URL.
2. Store the retrieved source documents.
3. Compare them with previously stored content to determine whether a policy is new or has changed.
4. Extract conditions such as age, income, region, monthly rent, deposit, benefit amount, and application method.
5. Convert the extracted information into internal policy rules that LifePass AI can compare.
6. Add the policy to the administrator review queue instead of exposing it directly to users.
7. Include only administrator-approved policies in actual benefit matching.
8. When combining a detail API response, verify that the requested policy ID matches the policy ID returned in the response.
9. Do not forcibly attach mismatched detail information to a policy. This prevents the eligibility conditions of one policy from being incorrectly mixed into another.

This review process is necessary because errors may occur when policy documents are interpreted automatically. Welfare policies affect real-life decisions, so collected results should be reviewed before being shown to users.

Even if an HTTP request succeeds, a response is treated as a collection error or review candidate rather than an approved policy when the API's internal response code indicates an error or required policy information is missing.

---

## 5. Security Checklist Before Deployment

Do not include a `.env` file containing real API keys in a public repository or submission ZIP file. If a real key has already been shared, revoke it and issue a new one.

The administrator API can be used only when `LIFEPASS_ADMIN_TOKEN` is configured. When the token is empty, administrator review and ingestion APIs are blocked. Policy candidates waiting for review are not mixed into user recommendations, and only administrator-approved policies are used for benefit matching.

Before deployment, run the following commands to verify basic functionality and security packaging:

```bash
npm run verify
npm run verify:security
```

---

## 6. Prerequisites

The following are required to run the project:

- Node.js
- npm
- The complete project files
- Official API credentials when using external policy ingestion

Submission ZIP files should not include `.env`, `.git`, `node_modules`, `dist`, or runtime ingestion data. A newly received project may not include `node_modules`, or it may include a version built for another operating system. In that case, reinstall the dependencies.

```bash
npm install
cp .env.example .env
# Replace LIFEPASS_ADMIN_TOKEN and required official API keys in .env with actual values
```

---
## 7. Running the Project

LifePass AI can run both a frontend interface and a backend server responsible for policy ingestion and search.

### 7.1 Running the Frontend Only

To quickly test the default demo policies and document parsing features, run:

```bash
npm run dev
```

Then open the following address in a browser:

```text
http://localhost:5173
```

In this mode, users can still upload files and review potential benefits using the default policy dataset.

---

### 7.2 Running the Backend Server Together

To use automated policy ingestion, policy search, and administrator review, open two terminal windows.

In the first terminal, run the backend server:

```bash
npm run server
```

In the second terminal, run the frontend:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

The backend server runs at the following address by default:

```text
http://localhost:8787
```

The frontend is configured to forward `/api` requests to the backend server.

---

### 7.3 Running a One-Time Policy Ingestion

After configuring external official APIs, run:

```bash
npm run ingest:once
```

This command performs the following steps:

1. Check the configured official API endpoints.
2. Request policy information when authentication keys are available.
3. Store the policy source documents.
4. Compare the documents with previously stored versions.
5. Extract conditions and generate a draft policy rule.
6. Add the candidate to the administrator review queue.

`ingest:once` runs the ingestion process only once. It is useful for manually testing policy ingestion during development.

---

### 7.4 Running Scheduled Policy Ingestion

To keep policy information updated during operation, run:

```bash
npm run ingest:schedule
```

This command repeats policy ingestion at a configured interval. By default, external policy sources are checked every few hours.

In a production environment, this feature should be used with a server process manager, cloud scheduler, cron job, or similar scheduling mechanism.

---

### 7.5 Verification

To verify that the project's core logic is working correctly, run:

```bash
npm run verify
```

This command checks:

- Whether required files are present
- Whether tab names contain unnecessary numeric prefixes
- Whether document parsing works correctly
- Whether policy documents and user documents can be distinguished
- Whether policy-ingestion modules load correctly
- Whether the application preparation screen contains the required information

---

### 7.6 Building for Deployment

To create frontend deployment files, run:

```bash
npm run build
```

The build output is generated in the `dist/` directory.

To preview the build locally, run:

```bash
npm run preview
```

---

## 8. Environment Variable Configuration

To use external policy ingestion, configure a `.env` file.

First, copy the example file:

```bash
cp .env.example .env
```

Then open `.env` and enter the required values.

### 8.1 Backend Server Settings

```env
LIFEPASS_API_HOST=0.0.0.0
LIFEPASS_API_PORT=8787
LIFEPASS_CORS_ORIGIN=http://localhost:5173
LIFEPASS_REQUIRE_ADMIN_TOKEN=true
LIFEPASS_MAX_BODY_BYTES=1048576
```

Descriptions:

- `LIFEPASS_API_HOST`: The address on which the backend server listens.
- `LIFEPASS_API_PORT`: The backend server port. The default is 8787.
- `LIFEPASS_CORS_ORIGIN`: The frontend origin allowed to access the backend. Separate multiple origins with commas.
- `LIFEPASS_REQUIRE_ADMIN_TOKEN`: Determines whether administrator APIs are blocked when the token is empty. Keep this set to `true` in production.
- `LIFEPASS_MAX_BODY_BYTES`: Maximum request body size for administrator APIs.

---

### 8.2 Administrator Token

```env
LIFEPASS_ADMIN_TOKEN=change-me-before-production
```

The administrator token protects administrative features such as running policy ingestion and approving or rejecting policy candidates.

In production, replace it with a long, unpredictable value. The current version blocks administrator APIs when the token is empty. Do not include a `.env` file containing a real token in a public repository or submission ZIP file.

---

### 8.3 Policy Storage and PostgreSQL Cache

```env
DATABASE_URL=postgresql://lifepass:lifepass@localhost:5432/lifepass
POLICY_STORE_DIR=./server/data/policy_store
POLICY_REFRESH_TTL_HOURS=24
```

When `DATABASE_URL` is configured, collected policies, legal references, source documents, search indexes, and API response caches are stored in PostgreSQL.

For the same API URL, the database cache is used first within the `POLICY_REFRESH_TTL_HOURS` period, preventing the same data from being requested every time the application runs.

When `DATABASE_URL` is empty, the system uses the JSON file store under `POLICY_STORE_DIR` as before.

PostgreSQL support requires the `pg` dependency, so run `npm install` again when enabling it.

---

### 8.4 Policy Ingestion Interval

```env
POLICY_SCHEDULER_INTERVAL_MS=21600000
```

This value controls how often policy ingestion repeats when `npm run ingest:schedule` is running.

For example, `21600000` represents six hours.

---

### 8.5 Bokjiro, Government24, and Public Data Portal API Settings

```env
BOKJIRO_SERVICE_KEY=
BOKJIRO_LOCAL_SERVICE_KEY=

BOKJIRO_CENTRAL_API_URL=http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001
BOKJIRO_CENTRAL_DETAIL_API_URL=http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfaredetailedV001

BOKJIRO_LOCAL_API_URL=http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist
BOKJIRO_LOCAL_DETAIL_API_URL=http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfaredetailed

GOV24_SERVICE_KEY=
GOV24_BENEFIT_API_URL=
```

Descriptions:

- `BOKJIRO_SERVICE_KEY`: Authentication key for calling the Bokjiro or Public Data Portal welfare-service API.
- `BOKJIRO_CENTRAL_API_URL`: API endpoint for central-government welfare service information.
- `BOKJIRO_CENTRAL_DETAIL_API_URL`: Endpoint for central-government welfare service detail queries. Configure a dedicated detail endpoint rather than reusing the list endpoint.
- `BOKJIRO_LOCAL_API_URL`: API endpoint for local-government welfare service information.
- `BOKJIRO_LOCAL_DETAIL_API_URL`: Endpoint for local-government welfare service detail queries. Use `LcgvWelfarelist` for list queries and `LcgvWelfaredetailed` for detail queries.
- `GOV24_SERVICE_KEY`: Authentication key for Government24 or public-service benefit APIs.
- `GOV24_BENEFIT_API_URL`: API endpoint for Government24 or public-service benefit information.

These values are not automatically included in the project. To use the real APIs, apply for access through the relevant institution or the Public Data Portal and enter the issued authentication keys and API URLs manually.

---

### 8.6 Korean Law Information Center Data Settings

```env
ENABLE_LAW_WELFARE_ACTS=true
LAW_OPEN_API_OC=
LAW_SEARCH_API_URL=http://www.law.go.kr/DRF/lawSearch.do
LAW_SERVICE_API_URL=http://www.law.go.kr/DRF/lawService.do
LAW_POLICY_QUERIES=복지,기초생활보장,청년,주거급여,고용보험
```

Enter the OC value issued by the Korean Law Information Center Open API in `LAW_OPEN_API_OC`.

The ingester searches for current welfare, housing, and employment-related laws using the terms in `LAW_POLICY_QUERIES` and enriches the data with the full-text API where possible.

Legal data is not used directly as a benefit-matching rule. Instead, it is shown separately as supporting material for policy decisions.

Collected laws are connected to policy areas such as housing, employment, livelihood, healthcare, education, and emergency assistance. This helps users understand the legal basis on which a policy operates.

In other words, a legal basis is not “a benefit I can receive immediately,” but “reference material explaining which law or system supports this policy decision.”

---

### 8.7 Enabling or Disabling Ingestion Sources

```env
ENABLE_BOKJIRO_CENTRAL=true
ENABLE_BOKJIRO_LOCAL=true
ENABLE_GOV24_BENEFITS=true
```

These values determine whether each policy source is enabled.

- `true`: Use the source.
- `false`: Do not use the source.

When an API key or URL has not yet been configured, it is recommended to set the corresponding value to `false`.

---

### 8.8 Supplementary Local-Government Announcement Collection

```env
ENABLE_LOCAL_NOTICE_CRAWLER=false
LOCAL_NOTICE_URLS=
```

These settings support supplementary collection of local-government announcements that may not yet be reflected in official APIs.

The feature is disabled by default. When enabling it, add only URLs explicitly approved by the operator to `LOCAL_NOTICE_URLS`.

Important considerations:

- Do not use it to indiscriminately scrape many websites.
- Review each website's terms of use and robots policy.
- Prioritize official APIs when the same information is available through an API.
- Show supplementary collected information to users only after review.

---
## 9. Example User Flows

### 9.1 General User Flow

1. The user opens LifePass AI.
2. Under `Import My Information`, the user uploads counseling notes or a document describing their circumstances.
3. The platform extracts age, region, income, monthly rent, deposit, expected income, and other relevant information.
4. The user corrects any incorrectly extracted values.
5. Under `Benefits You May Qualify For`, the user reviews policies for which they may be eligible.
6. Under `Welfare Cliff Preview`, the user reviews how eligibility may change when income changes.
7. Under `Prepare an Application`, the user checks required documents and next actions.
8. The final application is submitted through the official institution's website.

---

### 9.2 Policy Administrator Flow

1. Configure official API keys, the Korean Law Information Center OC value, and `DATABASE_URL` when needed in `.env`.
2. Run the backend server with `npm run server`.
3. Run a one-time policy ingestion with `npm run ingest:once`.
4. Collected policy candidates are added to the review queue.
5. The administrator reviews the policy name, source document, extracted conditions, and generated rules.
6. The administrator approves valid candidates.
7. Only approved policies are included in user benefit matching.

---

## 10. Command Summary

| Command | Purpose |
|---|---|
| `npm install` | Installs required packages. |
| `npm run dev` | Runs the user-facing frontend. |
| `npm run server` | Runs the backend server for policy ingestion, search, and review. |
| `npm run ingest:once` | Collects external policy information once. |
| `npm run ingest:schedule` | Collects external policy information periodically. |
| `npm run verify` | Checks whether major features work correctly. |
| `npm run build` | Creates production frontend files. |
| `npm run preview` | Previews the production build locally. |

---

## 11. Project Structure

```text
lifepass_react_lite/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── README.md
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   ├── data/
│   │   └── benefits.json
│   └── logic/
│       ├── documentPipeline.js
│       ├── lifepassCore.js
│       ├── policyIngestion.js
│       └── profileMerge.js
├── server/
│   ├── index.js
│   ├── ingestOnce.js
│   ├── scheduler.js
│   ├── config/
│   │   ├── env.js
│   │   └── policySources.js
│   └── lib/
│       ├── httpClient.js
│       ├── ingestionRunner.js
│       ├── policyNormalizer.js
│       ├── policyStore.js
│       ├── ruleGenerator.js
│       ├── searchIndex.js
│       └── textExtractors.js
├── scripts/
│   └── verify.mjs
└── docs/
```

Directory descriptions:

- `src/`: Contains the user-facing interface and browser-side logic.
- `src/data/benefits.json`: Contains the default demo policy data.
- `src/logic/`: Contains core logic for document parsing, benefit assessment, and welfare cliff calculation.
- `server/`: Handles automated policy ingestion, policy storage, change detection, administrator review, and search APIs.
- `server/config/`: Contains code that reads API keys, ingestion sources, and server settings.
- `server/lib/`: Contains detailed functions required for policy ingestion and normalization.
- `scripts/verify.mjs`: Project verification script.
- `docs/`: Directory for test inputs and explanatory documents.

---

## 12. What Makes LifePass Different

LifePass AI is not only a welfare information search service. It is designed to address both changes in the user's circumstances and the application preparation process.

Key differentiators include:

1. **Document-based information extraction**  
   Users can extract key information from counseling notes or related documents instead of manually entering many fields.

2. **Welfare cliff preview**  
   Users can review not only the benefits available now, but also which benefits may decrease after future income begins.

3. **Application-focused guidance**  
   The platform goes beyond recommendations and shows which documents to confirm and in what order to prepare them.

4. **Automated policy ingestion architecture**  
   The platform can move beyond demo policies by collecting candidates through official APIs and applying them after review.

5. **User-editable information**  
   Users can correct values extracted incorrectly from documents and review exactly which information is used in the final assessment.

---

## 13. Quick Start

To run the frontend, backend, and ingestion workflow together with one command, use:

```bash
bash scripts/dev-all.sh
```

To run each part step by step:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

To run the policy ingestion server as well, open two terminal windows and run:

```bash
npm run server
```

```bash
npm run dev
```

To test external policy ingestion, configure `.env` and run:

```bash
npm run ingest:once
```

To verify and build the project:

```bash
npm run verify
npm run build
```

---
