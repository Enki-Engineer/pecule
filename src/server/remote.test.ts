import { describe, expect, it } from "vitest";
import { cleanPrefix, parseDavList, parseS3List, signV4 } from "./remote.ts";

describe("signature d'une requête S3 (AWS Signature Version 4)", () => {
  it("retrouve la signature de l'exemple publié par AWS", () => {
    // Exemple de la documentation d'AWS (clés d'exemple, qui n'ouvrent rien).
    const authorization = signV4({
      method: "GET",
      path: "/",
      query: { Version: "2010-05-08", Action: "ListUsers" },
      headers: { Host: "iam.amazonaws.com", "Content-Type": "application/x-www-form-urlencoded; charset=utf-8", "X-Amz-Date": "20150830T123600Z" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "iam",
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });
});

describe("liste d'un compartiment S3", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>coffre</Name><Prefix>pecule/</Prefix><IsTruncated>true</IsTruncated><NextContinuationToken>suite&amp;fin</NextContinuationToken>
<Contents><Key>pecule/pecule-auto-2026-11-17-0205.zip.age</Key><LastModified>2026-11-17T02:06:10.000Z</LastModified><Size>208663155</Size></Contents>
<Contents><Key>pecule/notes &amp; brouillons.txt</Key><LastModified>2026-11-01T10:00:00.000Z</LastModified><Size>12</Size></Contents>
<Contents><Key>pecule/ancien/pecule-auto-2025-01-01-0205.zip.age</Key><LastModified>2025-01-01T02:06:10.000Z</LastModified><Size>5</Size></Contents>
<Contents><Key>autre/pecule-auto-2026-11-17-0205.zip.age</Key><Size>5</Size></Contents></ListBucketResult>`;

  it("rend les fichiers du préfixe, sans ses sous-dossiers, et la suite à demander", () => {
    expect(parseS3List(xml, "pecule/")).toEqual({
      files: [
        { name: "pecule-auto-2026-11-17-0205.zip.age", octets: 208663155, at: Date.parse("2026-11-17T02:06:10.000Z") },
        { name: "notes & brouillons.txt", octets: 12, at: Date.parse("2026-11-01T10:00:00.000Z") },
      ],
      next: "suite&fin",
    });
  });

  it("s'arrête quand la liste est complète", () => {
    expect(parseS3List("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>", "")).toEqual({ files: [], next: null });
  });

  it("range le préfixe", () => {
    expect(cleanPrefix(" /sauvegardes/pecule/ ")).toBe("sauvegardes/pecule/");
    expect(cleanPrefix("pecule")).toBe("pecule/");
    expect(cleanPrefix("/")).toBe("");
    expect(cleanPrefix("")).toBe("");
  });
});

describe("liste d'un dossier WebDAV", () => {
  it("rend les fichiers, pas le dossier ni ses sous-dossiers, quel que soit le préfixe des balises", () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/alex/Pecule/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/alex/Pecule/pecule-auto-2026-11-17-0205.zip.age</d:href><d:propstat><d:prop><d:getcontentlength>208663155</d:getcontentlength><d:getlastmodified>Tue, 17 Nov 2026 02:06:10 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/alex/Pecule/re%c3%a7u%20%26%20class%c3%a9.txt</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/alex/Pecule/anciennes</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`;
    expect(parseDavList(xml)).toEqual([
      { name: "pecule-auto-2026-11-17-0205.zip.age", octets: 208663155, at: Date.parse("2026-11-17T02:06:10Z") },
      { name: "reçu & classé.txt", octets: 12, at: null },
    ]);
  });

  it("lit aussi une réponse en majuscules et sans préfixe", () => {
    expect(parseDavList('<multistatus xmlns="DAV:"><response><href>/dav/a.zip.age</href><propstat><prop><getcontentlength>7</getcontentlength></prop></propstat></response></multistatus>')).toEqual([{ name: "a.zip.age", octets: 7, at: null }]);
    expect(parseDavList('<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/b.zip.age</D:href><D:propstat><D:prop><D:getcontentlength>9</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>')).toEqual([{ name: "b.zip.age", octets: 9, at: null }]);
  });
});
